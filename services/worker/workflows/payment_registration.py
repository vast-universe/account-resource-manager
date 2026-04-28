"""Payment registration workflow orchestration."""

from __future__ import annotations

import logging
import uuid
from concurrent.futures import CancelledError, ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, List, Optional

import psycopg2
from psycopg2.extras import RealDictCursor

from chatgpt.payment_registration_engine import PaymentRegistrationEngine
from core.task_runtime import (
    AttemptOutcome,
    AttemptResult,
    RegisterTaskControl,
    SkipCurrentAttemptRequested,
    StopTaskRequested,
)
from utils.email_service import EmailServiceAdapter

logger = logging.getLogger(__name__)


@dataclass
class PaymentRegistrationJob:
    task_ids: List[str]
    count: int
    concurrency: int


def _connect(database_url: str):
    return psycopg2.connect(database_url)


def save_account_to_db(database_url: str, result, task_id: str) -> int:
    conn = _connect(database_url)
    cursor = conn.cursor()
    try:
        email_normalized = result.email.lower().strip() if result.email else ""
        cursor.execute(
            """
            INSERT INTO chatgpt_accounts (
                public_id, email, email_normalized, password, access_token, refresh_token,
                id_token, session_token, account_id, status,
                health_status, registration_source, checkout_url, team_checkout_url,
                email_service_id, region, created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            RETURNING id
            """,
            (
                task_id,
                result.email,
                email_normalized,
                result.password,
                result.access_token,
                result.refresh_token,
                result.id_token,
                result.session_token,
                result.account_id,
                "active" if result.success else "abnormal",
                "unknown",
                "payment_register",
                result.checkout_url,
                result.team_checkout_url,
                result.email_service_id,
                result.region if hasattr(result, "region") else None,
                datetime.now(),
                datetime.now(),
            ),
        )
        account_id = cursor.fetchone()[0]
        conn.commit()
        logger.info("账号已保存到数据库: %s id=%s", result.email, account_id)
        return account_id
    finally:
        cursor.close()
        conn.close()


def log_task(database_url: str, task_id: str, message: str) -> None:
    timestamp = datetime.now().strftime("%H:%M:%S")
    log_message = f"[{timestamp}] {message}"
    logger.info("[%s] %s", task_id, log_message)

    try:
        conn = _connect(database_url)
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE registration_tasks
            SET logs = array_append(logs, %s)
            WHERE task_id = %s
            """,
            (log_message, task_id),
        )
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as exc:
        logger.error("记录日志失败: %s", exc)


def _update_task_running(database_url: str, task_id: str, progress: str) -> None:
    conn = _connect(database_url)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE registration_tasks
            SET status = 'running', started_at = %s, progress = %s
            WHERE task_id = %s
            """,
            (datetime.now(), progress, task_id),
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def _update_task_finished(database_url: str, task_id: str, success: bool, result_email: Optional[str], error: Optional[str]) -> None:
    conn = _connect(database_url)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE registration_tasks
            SET status = %s, completed_at = %s, result = %s, error_message = %s
            WHERE task_id = %s
            """,
            ("completed" if success else "failed", datetime.now(), result_email if success else None, error if not success else None, task_id),
        )
        conn.commit()
    finally:
        cursor.close()
        conn.close()


def create_payment_registration_tasks(database_url: str, count: int, concurrency: int) -> PaymentRegistrationJob:
    count = max(1, min(count, 50))
    concurrency = max(1, min(concurrency, 5))
    task_ids = []

    conn = _connect(database_url)
    cursor = conn.cursor()
    try:
        for _ in range(count):
            task_id = str(uuid.uuid4())
            task_ids.append(task_id)
            cursor.execute(
                """
                INSERT INTO registration_tasks (
                    task_id, task_type, status, created_at
                ) VALUES (%s, %s, %s, %s)
                """,
                (task_id, "payment_registration", "pending", datetime.now()),
            )
        conn.commit()
    finally:
        cursor.close()
        conn.close()

    return PaymentRegistrationJob(task_ids=task_ids, count=count, concurrency=concurrency)


def run_single_payment_registration(
    database_url: str,
    task_id: str,
    control: RegisterTaskControl,
    index: int,
    total: int,
    next_proxy: Callable[[], Optional[str]],
) -> AttemptResult:
    attempt_id = None
    try:
        control.checkpoint()
        attempt_id = control.start_attempt()
        control.checkpoint(attempt_id=attempt_id)

        proxy_url = next_proxy()
        if proxy_url:
            log_task(database_url, task_id, f"使用代理: {proxy_url}")

        log_task(database_url, task_id, f"开始注册第 {index + 1}/{total} 个账号")
        _update_task_running(database_url, task_id, f"{index + 1}/{total}")

        email_service = EmailServiceAdapter(database_url=database_url, email_provider_id=None)
        engine = PaymentRegistrationEngine(
            email_service=email_service,
            proxy_url=proxy_url,
            browser_mode="protocol",
            callback_logger=lambda msg: log_task(database_url, task_id, msg),
            task_uuid=task_id,
            max_retries=3,
        )

        control.checkpoint(attempt_id=attempt_id)
        result = engine.run()
        email_service.record_registration_result(result.success, result.error_message)

        if result.success:
            save_account_to_db(database_url, result, task_id)
            log_task(database_url, task_id, f"✅ 第 {index + 1}/{total} 个账号注册成功: {result.email}")
            log_task(database_url, task_id, "已保存支付链接，跳过自动 token 提取")
        else:
            log_task(database_url, task_id, f"❌ 第 {index + 1}/{total} 个账号注册失败: {result.error_message}")

        _update_task_finished(
            database_url,
            task_id,
            result.success,
            result.email if result.success else None,
            result.error_message if not result.success else None,
        )
        return AttemptResult.success() if result.success else AttemptResult.failed(result.error_message)

    except SkipCurrentAttemptRequested as exc:
        log_task(database_url, task_id, f"[SKIP] 已跳过当前账号: {exc}")
        return AttemptResult.skipped(str(exc))
    except StopTaskRequested as exc:
        log_task(database_url, task_id, f"[STOP] {exc}")
        return AttemptResult.stopped(str(exc))
    except Exception as exc:
        logger.error("支付注册任务失败: %s, 错误: %s", task_id, exc)
        log_task(database_url, task_id, f"[FAIL] 注册失败: {exc}")
        try:
            _update_task_finished(database_url, task_id, False, None, str(exc))
        except Exception as db_error:
            logger.error("更新任务状态失败: %s", db_error)
        return AttemptResult.failed(str(exc))
    finally:
        if attempt_id is not None:
            control.finish_attempt(attempt_id)


def run_batch_payment_registration(
    database_url: str,
    task_ids: List[str],
    concurrency: int,
    next_proxy: Callable[[], Optional[str]],
) -> None:
    control = RegisterTaskControl()
    success = 0
    skipped = 0
    errors = []
    stopped = False
    total = len(task_ids)

    logger.info("开始批量支付注册: 总数=%s, 并发=%s", total, concurrency)
    max_workers = min(concurrency, total)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [
            pool.submit(
                run_single_payment_registration,
                database_url,
                task_ids[index],
                control,
                index,
                total,
                next_proxy,
            )
            for index in range(total)
        ]

        for future in as_completed(futures):
            try:
                result = future.result()
            except CancelledError:
                continue
            except Exception as exc:
                logger.error("任务线程异常: %s", exc)
                errors.append(str(exc))
                continue

            if result.outcome == AttemptOutcome.SUCCESS:
                success += 1
            elif result.outcome == AttemptOutcome.SKIPPED:
                skipped += 1
            elif result.outcome == AttemptOutcome.STOPPED:
                stopped = True
            else:
                errors.append(result.message)

            if stopped or control.is_stop_requested():
                stopped = True
                for pending in futures:
                    if pending is not future:
                        pending.cancel()

    logger.info("批量注册完成: 成功=%s, 跳过=%s, 失败=%s", success, skipped, len(errors))


def get_task_status(database_url: str, task_id: str) -> Optional[dict]:
    conn = _connect(database_url)
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute(
            """
            SELECT task_id, task_type, status, result, error_message,
                   logs, progress, created_at, started_at, completed_at
            FROM registration_tasks
            WHERE task_id = %s
            """,
            (task_id,),
        )
        task = cursor.fetchone()
        return dict(task) if task else None
    finally:
        cursor.close()
        conn.close()
