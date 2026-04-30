"""
Worker Service - 支付注册服务
"""
import os
import logging
import threading
import time
from typing import Any, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import requests

from workflows.chatgpt_extract_tokens import (
    ChatGPTTokenExtractionError,
    extract_tokens_for_account,
    update_chatgpt_account_refresh_status as workflow_update_chatgpt_account_refresh_status,
)
from workflows.chatgpt_export_sub2api import (
    ChatGPTSub2ApiExportError,
    export_sub2api as export_sub2api_workflow,
)
from workflows.chatgpt_token_lifecycle import refresh_subscription_status
from workflows.payment_registration import (
    create_payment_registration_tasks,
    get_task_status as get_registration_task_status,
    run_batch_payment_registration,
)
from workflows.chatgpt_team import (
    ChatGPTTeamWorkflowError,
    get_team_members,
    invite_team_members,
    mutual_bind_team_members,
)
from integrations.moemail_webhook_cache import store_webhook_event
from core.proxy_utils import normalize_proxy_url

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Account Resource Manager Worker")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("ARM_DATABASE_URL")
if not DATABASE_URL:
    raise Exception("DATABASE_URL or ARM_DATABASE_URL environment variable is required")


class PaymentRegistrationRequest(BaseModel):
    count: int = 30
    concurrency: int = 5


class PaymentRegistrationResponse(BaseModel):
    task_ids: list[str]
    status: str
    message: str


class TeamInviteRequest(BaseModel):
    mother_account_id: int
    target_account_ids: list[int]
    accept_invites: bool = True


class TeamMutualBindRequest(BaseModel):
    account_ids: list[int]
    accept_invites: bool = True
    refresh_after: bool = True
    concurrency: int = 0


class MoeMailWebhookRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    emailId: Optional[str] = None
    messageId: Optional[str] = None
    fromAddress: Optional[str] = None
    subject: Optional[str] = None
    content: Optional[str] = None
    html: Optional[str] = None
    receivedAt: Optional[str] = None
    toAddress: Optional[str] = None

# 代理池管理
_proxy_pool_lock = threading.Lock()
_proxy_pool_index = 0
_proxy_schema_ready = False
_app_settings_schema_ready = False
PROXY_CHECK_URL = os.getenv("PROXY_CHECK_URL", "https://chatgpt.com/cdn-cgi/trace")
PROXY_CHECK_TIMEOUT = float(os.getenv("PROXY_CHECK_TIMEOUT", "8"))
PROXY_RECENT_SUCCESS_SECONDS = int(os.getenv("PROXY_RECENT_SUCCESS_SECONDS", "180"))


def ensure_app_settings_table():
    global _app_settings_schema_ready
    if _app_settings_schema_ready:
        return

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cursor.execute(
                """
                INSERT INTO app_settings (key, value)
                VALUES ('proxy.enabled', 'true')
                ON CONFLICT (key) DO NOTHING
                """
            )
        conn.commit()
        _app_settings_schema_ready = True
    finally:
        conn.close()


def is_proxy_enabled() -> bool:
    try:
        ensure_app_settings_table()
        conn = get_db_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT value FROM app_settings WHERE key = 'proxy.enabled'")
                row = cursor.fetchone()
                if not row:
                    return True
                return str(row[0]).strip().lower() != "false"
        finally:
            conn.close()
    except Exception as exc:
        logger.debug("读取代理总开关失败，默认启用代理: %s", exc)
        return True


def ensure_proxy_health_columns():
    global _proxy_schema_ready
    if _proxy_schema_ready:
        return

    conn = get_db_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                ALTER TABLE proxies
                ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
                ADD COLUMN IF NOT EXISTS latency_ms INTEGER,
                ADD COLUMN IF NOT EXISTS success_count INTEGER NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS last_error TEXT
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_proxies_health
                ON proxies(is_active, failure_count, latency_ms, last_success_at)
                WHERE deleted_at IS NULL
                """
            )
        conn.commit()
        _proxy_schema_ready = True
    finally:
        conn.close()


def record_proxy_success(proxy_id: int, latency_ms: int):
    try:
        ensure_proxy_health_columns()
        conn = get_db_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE proxies
                    SET
                        last_used_at = NOW(),
                        last_success_at = NOW(),
                        last_checked_at = NOW(),
                        latency_ms = %s,
                        success_count = success_count + 1,
                        last_error = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (latency_ms, proxy_id),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        logger.debug("记录代理成功状态失败: %s", exc)


def record_proxy_failure(proxy_id: int, error: str):
    try:
        ensure_proxy_health_columns()
        conn = get_db_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE proxies
                    SET
                        last_used_at = NOW(),
                        last_failure_at = NOW(),
                        last_checked_at = NOW(),
                        failure_count = failure_count + 1,
                        last_error = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (error[:500], proxy_id),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:
        logger.debug("记录代理失败状态失败: %s", exc)


def is_recent_proxy_success(proxy: dict[str, Any]) -> bool:
    last_success_at = proxy.get("last_success_at")
    if not last_success_at:
        return False
    try:
        return (time.time() - last_success_at.timestamp()) <= PROXY_RECENT_SUCCESS_SECONDS
    except Exception:
        return False


def check_proxy_health(proxy_url: str) -> tuple[bool, int, str]:
    started_at = time.perf_counter()
    try:
        response = requests.get(
            PROXY_CHECK_URL,
            proxies={"http": proxy_url, "https": proxy_url},
            timeout=PROXY_CHECK_TIMEOUT,
        )
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        if response.status_code < 500:
            return True, latency_ms, ""
        return False, latency_ms, f"HTTP {response.status_code}"
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started_at) * 1000)
        return False, latency_ms, str(exc)


def get_next_proxy() -> Optional[str]:
    """从数据库获取健康优先的可用代理。"""
    global _proxy_pool_index

    try:
        if not is_proxy_enabled():
            logger.info("代理总开关已关闭，本次直连")
            return None

        ensure_proxy_health_columns()
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            """
            SELECT
                id, url, latency_ms, success_count, failure_count,
                last_success_at, last_failure_at
            FROM proxies
            WHERE deleted_at IS NULL AND is_active = true
            ORDER BY
                CASE WHEN last_success_at IS NULL THEN 1 ELSE 0 END,
                COALESCE(failure_count, 0) ASC,
                COALESCE(latency_ms, 999999) ASC,
                COALESCE(success_count, 0) DESC,
                id ASC
            """
        )
        proxies = cursor.fetchall()
        cursor.close()
        conn.close()

        if not proxies:
            return None

        with _proxy_pool_lock:
            start_index = _proxy_pool_index % len(proxies)
            _proxy_pool_index += 1
            ordered_proxies = proxies[start_index:] + proxies[:start_index]

        for proxy in ordered_proxies:
            proxy_url = normalize_proxy_url(proxy["url"])
            if not proxy_url:
                continue

            if is_recent_proxy_success(proxy):
                logger.info("使用近期健康代理: id=%s latency=%sms", proxy["id"], proxy.get("latency_ms") or "-")
                return proxy_url

            ok, latency_ms, error = check_proxy_health(proxy_url)
            if ok:
                record_proxy_success(int(proxy["id"]), latency_ms)
                logger.info("代理检测成功: id=%s latency=%sms", proxy["id"], latency_ms)
                return proxy_url

            record_proxy_failure(int(proxy["id"]), error)
            logger.warning("代理检测失败: id=%s error=%s", proxy["id"], error[:160])

        logger.warning("所有启用代理检测失败，本次改为直连")
        return None
    except Exception as e:
        logger.error(f"获取代理失败: {e}")
        return None


def get_db_connection():
    return psycopg2.connect(DATABASE_URL)


@app.post("/api/webhooks/moemail")
async def receive_moemail_webhook(payload: MoeMailWebhookRequest):
    """Cache MoeMail webhook messages in memory for OTP/invite pickup."""
    data: dict[str, Any] = payload.model_dump()
    result = store_webhook_event(data)
    return {"success": bool(result.get("stored")), **result}


@app.post("/api/payment-registration", response_model=PaymentRegistrationResponse)
async def create_payment_registration(
    request: PaymentRegistrationRequest,
    background_tasks: BackgroundTasks
):
    """创建支付注册任务（支持批量和并发）"""
    try:
        job = create_payment_registration_tasks(
            DATABASE_URL,
            request.count,
            request.concurrency,
        )

        # 在后台线程中执行批量任务（支持并发）
        background_tasks.add_task(
            run_batch_payment_registration,
            DATABASE_URL,
            job.task_ids,
            job.concurrency,
            get_next_proxy,
        )

        return PaymentRegistrationResponse(
            task_ids=job.task_ids,
            status="pending",
            message=f"已创建 {job.count} 个支付注册任务，并发数: {job.concurrency}"
        )

    except Exception as e:
        logger.error(f"创建支付注册任务失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/tasks/{task_id}")
async def get_task_status(task_id: str):
    """获取任务状态"""
    try:
        task = get_registration_task_status(DATABASE_URL, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="任务不存在")

        return task

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取任务状态失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """健康检查"""
    return {"status": "healthy", "service": "worker"}


@app.post("/api/teams/invite")
async def invite_team_members_api(request: TeamInviteRequest):
    """手动邀请账号加入指定母号 Team，并按需通过 MoeMail 自动接受。"""
    try:
        return invite_team_members(
            database_url=DATABASE_URL,
            mother_account_id=request.mother_account_id,
            target_account_ids=request.target_account_ids,
            accept_invites=request.accept_invites,
            next_proxy=get_next_proxy,
        )
    except HTTPException:
        raise
    except ChatGPTTeamWorkflowError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except Exception as e:
        logger.error(f"Team 手动邀请失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/teams/mutual-bind")
async def mutual_bind_team_members_api(request: TeamMutualBindRequest):
    """手动选择一批 Team 账号，按每组最多 5 个执行组内互拉。"""
    try:
        return mutual_bind_team_members(
            database_url=DATABASE_URL,
            account_ids=request.account_ids,
            accept_invites=request.accept_invites,
            refresh_after=request.refresh_after,
            concurrency=request.concurrency or None,
            next_proxy=get_next_proxy,
        )
    except HTTPException:
        raise
    except ChatGPTTeamWorkflowError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except Exception as e:
        logger.error(f"Team 互拉失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/teams/members/{account_id}")
async def get_team_members_api(
    account_id: int,
    offset: int = 0,
    limit: int = 25,
    query: str = "",
):
    """查询并缓存指定账号的母号 Team 成员。"""
    try:
        return get_team_members(
            database_url=DATABASE_URL,
            account_id=account_id,
            offset=offset,
            limit=limit,
            query=query,
            next_proxy=get_next_proxy,
        )
    except ChatGPTTeamWorkflowError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except Exception as e:
        logger.error(f"查询 Team 成员失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/teams")
async def get_teams():
    """Team 邀请进度已不再存储。"""
    return {"teams": [], "message": "Team 邀请进度已不再存储"}


@app.get("/api/teams/{team_id}/invitations")
async def get_team_invitations(team_id: int):
    """Team 邀请进度已不再存储。"""
    return {"invitations": [], "message": "Team 邀请进度已不再存储"}


class TokenExtractionRequest(BaseModel):
    account_id: int
    moemail_email_id: Optional[str] = None


class TokenRefreshRequest(BaseModel):
    account_id: int
    workspace_id: Optional[str] = None


class Sub2ApiExportRequest(BaseModel):
    account_ids: list[int] = []


@app.post("/api/chatgpt/extract-tokens")
async def extract_tokens(request: TokenExtractionRequest, background_tasks: BackgroundTasks):
    """刷新账号 tokens：登录账号，按 Codex OAuth 流程提取并保存当前账号 token。"""
    try:
        return extract_tokens_for_account(
            database_url=DATABASE_URL,
            account_id=request.account_id,
            moemail_email_id=request.moemail_email_id,
            proxy_url=get_next_proxy(),
        )

    except HTTPException:
        raise
    except ChatGPTTokenExtractionError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except Exception as e:
        logger.error(f"提取 tokens 失败: {e}")
        workflow_update_chatgpt_account_refresh_status(
            DATABASE_URL,
            request.account_id,
            "abnormal",
            "invalid",
            str(e),
        )
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chatgpt/refresh-subscription")
async def refresh_chatgpt_subscription(request: TokenRefreshRequest):
    """轻量刷新已保存 OAuth token，并根据 token claims 更新订阅状态。"""
    try:
        return refresh_subscription_status(
            database_url=DATABASE_URL,
            account_id=request.account_id,
            workspace_id=request.workspace_id,
            proxy_url=get_next_proxy(),
        )
    except ChatGPTTokenExtractionError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except Exception as e:
        logger.error(f"刷新订阅状态失败: {e}")
        workflow_update_chatgpt_account_refresh_status(
            DATABASE_URL,
            request.account_id,
            "abnormal",
            "invalid",
            str(e),
        )
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/chatgpt/export-sub2api")
@app.post("/api/chatgpt/export-sub2api")
async def export_sub2api(request: Optional[Sub2ApiExportRequest] = None):
    """导出账号 workspace tokens 为 sub2api 批量导入格式。可传 account_ids 限定账号。"""
    try:
        return export_sub2api_workflow(DATABASE_URL, account_ids=(request.account_ids if request else None))
    except ChatGPTSub2ApiExportError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"导出 sub2api 配置失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("WORKER_PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
