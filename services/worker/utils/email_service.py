"""
邮箱服务适配器 - 用于支付注册流程
"""
import logging
import os
import time
import re
from typing import Optional, Dict, Any, List
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)


class EmailServiceAdapter:
    """邮箱服务适配器，用于支付注册引擎"""

    def __init__(self, database_url: str, email_provider_id: Optional[int] = None):
        self.database_url = database_url
        self.email_provider_id = email_provider_id
        self.conn = None
        self.current_email_id = None  # 存储当前创建的邮箱 ID
        self.current_provider_id = None
        self.current_domain = None
        self.domain_failure_threshold = max(1, int(os.getenv("EMAIL_DOMAIN_FAILURE_THRESHOLD", "5")))

    def _get_connection(self):
        if not self.conn or self.conn.closed:
            self.conn = psycopg2.connect(self.database_url)
        return self.conn

    def _get_provider(self) -> Dict[str, Any]:
        """获取邮箱提供商配置"""
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # 如果指定了 email_provider_id，使用该提供商
        if self.email_provider_id:
            cursor.execute(
                """
                SELECT id, api_url, api_key, provider_type
                FROM email_providers
                WHERE id = %s AND deleted_at IS NULL
                """,
                (self.email_provider_id,)
            )
        else:
            # 否则选择一个可用的提供商
            cursor.execute(
                """
                SELECT id, api_url, api_key, provider_type
                FROM email_providers
                WHERE deleted_at IS NULL AND status = 'active'
                ORDER BY is_default DESC, created_at DESC
                LIMIT 1
                """
            )

        provider = cursor.fetchone()
        cursor.close()

        if not provider:
            raise Exception("没有可用的邮箱提供商")

        provider_dict = dict(provider)
        if not provider_dict.get('api_key'):
            raise Exception("邮箱提供商未配置 API key")

        return provider_dict

    def _ensure_domain_table(self) -> None:
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS email_provider_domains (
                    provider_id BIGINT NOT NULL REFERENCES email_providers(id) ON DELETE CASCADE,
                    domain TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'blocked')),
                    consecutive_failures INTEGER NOT NULL DEFAULT 0,
                    total_failures INTEGER NOT NULL DEFAULT 0,
                    total_successes INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    last_used_at TIMESTAMPTZ,
                    last_failed_at TIMESTAMPTZ,
                    blocked_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (provider_id, domain)
                )
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_email_provider_domains_provider_status
                    ON email_provider_domains(provider_id, status, updated_at DESC)
                """
            )
            conn.commit()
        finally:
            cursor.close()

    def _sync_domains(self, provider_id: int, domains: List[str]) -> None:
        if not domains:
            return

        self._ensure_domain_table()
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            for domain in domains:
                cursor.execute(
                    """
                    INSERT INTO email_provider_domains (provider_id, domain)
                    VALUES (%s, %s)
                    ON CONFLICT (provider_id, domain) DO NOTHING
                    """,
                    (provider_id, domain),
                )
            conn.commit()
        finally:
            cursor.close()

    def _select_domain(self, provider_id: int, domains: List[str]) -> Optional[str]:
        domains = [domain.strip() for domain in domains if domain and domain.strip()]
        if not domains:
            return None

        self._sync_domains(provider_id, domains)
        conn = self._get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        try:
            cursor.execute(
                """
                SELECT domain, status, consecutive_failures
                FROM email_provider_domains
                WHERE provider_id = %s AND domain = ANY(%s)
                """,
                (provider_id, domains),
            )
            rows = {row["domain"]: row for row in cursor.fetchall()}
        finally:
            cursor.close()

        for domain in domains:
            row = rows.get(domain)
            if not row or row.get("status") != "blocked":
                return domain

        fallback = min(domains, key=lambda item: int(rows.get(item, {}).get("consecutive_failures") or 0))
        logger.warning("所有邮箱域名都已标记 blocked，临时使用失败次数最少的域名: %s", fallback)
        return fallback

    def record_registration_result(self, success: bool, error_message: Optional[str] = None) -> None:
        if not self.current_provider_id or not self.current_domain:
            return

        self._ensure_domain_table()
        conn = self._get_connection()
        cursor = conn.cursor()
        try:
            if success:
                cursor.execute(
                    """
                    INSERT INTO email_provider_domains (
                        provider_id, domain, status, consecutive_failures,
                        total_successes, last_error, last_used_at, updated_at
                    )
                    VALUES (%s, %s, 'active', 0, 1, NULL, NOW(), NOW())
                    ON CONFLICT (provider_id, domain) DO UPDATE
                    SET
                        status = 'active',
                        consecutive_failures = 0,
                        total_successes = email_provider_domains.total_successes + 1,
                        last_error = NULL,
                        last_used_at = NOW(),
                        blocked_at = NULL,
                        updated_at = NOW()
                    """,
                    (self.current_provider_id, self.current_domain),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO email_provider_domains (
                        provider_id, domain, status, consecutive_failures,
                        total_failures, last_error, last_used_at, last_failed_at, blocked_at, updated_at
                    )
                    VALUES (
                        %s, %s,
                        CASE WHEN %s <= 1 THEN 'blocked' ELSE 'active' END,
                        1, 1, %s, NOW(), NOW(),
                        CASE WHEN %s <= 1 THEN NOW() ELSE NULL END,
                        NOW()
                    )
                    ON CONFLICT (provider_id, domain) DO UPDATE
                    SET
                        consecutive_failures = email_provider_domains.consecutive_failures + 1,
                        total_failures = email_provider_domains.total_failures + 1,
                        last_error = EXCLUDED.last_error,
                        last_used_at = NOW(),
                        last_failed_at = NOW(),
                        status = CASE
                            WHEN email_provider_domains.consecutive_failures + 1 >= %s THEN 'blocked'
                            ELSE email_provider_domains.status
                        END,
                        blocked_at = CASE
                            WHEN email_provider_domains.consecutive_failures + 1 >= %s
                            THEN COALESCE(email_provider_domains.blocked_at, NOW())
                            ELSE email_provider_domains.blocked_at
                        END,
                        updated_at = NOW()
                    """,
                    (
                        self.current_provider_id,
                        self.current_domain,
                        self.domain_failure_threshold,
                        (error_message or "")[:500],
                        self.domain_failure_threshold,
                        self.domain_failure_threshold,
                        self.domain_failure_threshold,
                    ),
                )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.warning("记录邮箱域名状态失败: %s", exc)
        finally:
            cursor.close()

    def create_email(self) -> Dict[str, Any]:
        """
        创建邮箱
        返回: {"email": "xxx@xxx.com", "service_id": "email_id"}
        """
        try:
            provider = self._get_provider()

            # 根据 provider_type 调用不同的邮箱服务 API
            if provider['provider_type'] == 'moemail':
                email, email_id = self._create_moemail_email(provider)
                self.current_email_id = email_id
            else:
                raise Exception(f"不支持的邮箱提供商类型: {provider['provider_type']}")

            return {
                "email": email,
                "service_id": email_id
            }

        except Exception as e:
            logger.error(f"创建邮箱失败: {e}")
            raise

    def _create_moemail_email(self, provider: Dict) -> tuple[str, str]:
        """
        调用 moemail API 创建邮箱
        返回: (email, email_id)
        """
        import requests

        api_url = provider['api_url'].rstrip('/')
        api_key = provider['api_key']

        # 首先获取可用域名
        try:
            config_response = requests.get(
                f"{api_url}/api/config",
                headers={"X-API-Key": api_key},
                timeout=15
            )
            config_response.raise_for_status()
            config = config_response.json()

            domains = config.get('emailDomains', '').split(',')
            domain = self._select_domain(int(provider["id"]), domains)

            logger.info(f"使用域名: {domain}")
        except Exception as e:
            logger.warning(f"获取域名配置失败: {e}，使用默认配置")
            domain = None

        # 调用 moemail 生成邮箱 API
        payload = {
            "expiryTime": 0,  # 永久邮箱
        }
        if domain:
            payload["domain"] = domain
            self.current_provider_id = int(provider["id"])
            self.current_domain = domain

        response = requests.post(
            f"{api_url}/api/emails/generate",
            headers={
                "X-API-Key": api_key,
                "Content-Type": "application/json"
            },
            json=payload,
            timeout=30
        )
        response.raise_for_status()
        data = response.json()

        email = data.get('email')
        email_id = data.get('id')

        if not email or not email_id:
            raise Exception(f"moemail API 返回数据不完整: {data}")

        logger.info(f"成功创建邮箱: {email}, ID: {email_id}")
        return email, email_id

    def get_verification_code(self, email: str, timeout: int = 120) -> Optional[str]:
        """
        获取验证码 - 通过 moemail API 查询邮件
        """
        if not self.current_email_id:
            logger.error("未找到邮箱 ID，无法查询邮件")
            return None

        start_time = time.time()
        provider = self._get_provider()
        api_url = provider['api_url'].rstrip('/')
        api_key = provider['api_key']

        import requests

        logger.info(f"开始查询验证码，邮箱ID: {self.current_email_id}, 超时: {timeout}秒")

        while time.time() - start_time < timeout:
            try:
                # 调用 moemail API 获取邮件列表
                response = requests.get(
                    f"{api_url}/api/emails/{self.current_email_id}",
                    headers={"X-API-Key": api_key},
                    timeout=15
                )

                if response.status_code == 200:
                    data = response.json()
                    messages = data.get('messages', [])

                    logger.info(f"收到 {len(messages)} 封邮件")

                    # 遍历邮件查找验证码
                    for msg in messages:
                        # 获取邮件内容
                        subject = msg.get('subject', '')
                        body = msg.get('text', '') or msg.get('content', '') or msg.get('body', '') or msg.get('html', '')

                        logger.info(f"检查邮件: {subject[:50]}")

                        # OpenAI 验证码格式: 6位数字
                        # 按优先级排序的验证码模式（从最精确到最宽泛）
                        patterns = [
                            # OpenAI 特定的HTML结构（最精确）- 24px字体的p标签
                            r'<p[^>]*font-size:\s*24px[^>]*>.*?(\d{6}).*?</p>',
                            # 通用模式
                            r"Verification code:?\s*(\d{6})",
                            r"code is\s*(\d{6})",
                            r"your code is[:\s]+(\d{6})",
                        ]

                        for pattern in patterns:
                            match = re.search(pattern, body, re.IGNORECASE | re.DOTALL)
                            if match:
                                code = match.group(1)
                                logger.info(f"找到验证码: {code} (使用精确模式)")
                                return code

                        # 如果精确模式都没匹配到，使用宽泛模式但排除已知误判
                        fallback_pattern = r"(?<![#&:])\b(\d{6})\b"
                        matches = re.findall(fallback_pattern, body)
                        for code in matches:
                            # 排除已知的误判验证码（CSS颜色值等）
                            if code in ["177010", "202123", "202167", "353740"]:
                                logger.info(f"跳过已知误判验证码: {code}")
                                continue
                            logger.info(f"找到验证码: {code} (使用宽泛匹配)")
                            return code

                else:
                    logger.warning(f"查询邮件失败: HTTP {response.status_code}")

                # 等待后重试
                time.sleep(3)

            except Exception as e:
                logger.error(f"查询邮件异常: {e}")
                time.sleep(3)

        logger.warning(f"超时 {timeout} 秒未收到验证码")
        return None

    def __del__(self):
        if self.conn and not self.conn.closed:
            self.conn.close()
