"""
支付注册引擎
使用 ChatGPTClient (curl_cffi) 完成注册流程
"""

import time
import random
import logging
from datetime import datetime
from typing import Optional, Callable

from core.task_runtime import TaskInterruption
from chatgpt.chatgpt_client import ChatGPTClient
from chatgpt.utils import generate_random_name, generate_random_birthday
from chatgpt.currency_mapping import get_currency_for_country
from chatgpt.models import PaymentRegistrationResult

logger = logging.getLogger(__name__)


class PaymentRegistrationEngine:
    """支付注册引擎（使用 ChatGPTClient）"""

    def __init__(
        self,
        email_service,
        proxy_url: Optional[str] = None,
        browser_mode: str = "protocol",
        callback_logger: Optional[Callable[[str], None]] = None,
        task_uuid: Optional[str] = None,
        max_retries: int = 3,
        extra_config: Optional[dict] = None,
    ):
        self.email_service = email_service
        self.proxy_url = proxy_url
        self.browser_mode = "protocol"
        self.callback_logger = callback_logger
        self.task_uuid = task_uuid
        self.max_retries = max(1, int(max_retries or 1))
        self.extra_config = dict(extra_config or {})

        self.email = None
        self.password = None
        self.logs = []

    def _log(self, message: str, level: str = "info"):
        """记录日志"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_message = f"[{timestamp}] {message}"
        self.logs.append(log_message)
        if self.callback_logger:
            self.callback_logger(log_message)
        if level == "error":
            logger.error(log_message)
        else:
            logger.info(log_message)

    def run(self) -> PaymentRegistrationResult:
        """运行支付注册流程"""
        try:
            self._log("="*60)
            self._log("开始支付注册流程（使用 ChatGPTClient）")
            self._log("="*60)

            # Step 1: 创建邮箱
            self._log("[1/15] 创建邮箱...")
            email_data = self.email_service.create_email()
            email = email_data.get("email", "")
            email_service_id = email_data.get("service_id", "")  # 获取 MoeMail 邮箱 ID
            if not email:
                return PaymentRegistrationResult(
                    success=False,
                    error_message="创建邮箱失败"
                )
            self._log(f"✓ 邮箱: {email}")
            if email_service_id:
                self._log(f"✓ MoeMail 邮箱 ID: {email_service_id}")

            # 生成密码
            if not self.password:
                import string
                password_chars = string.ascii_letters + string.digits + "!@#$%^&*"
                self.password = ''.join(random.choices(password_chars, k=12))
                self.password = self.password[0].upper() + self.password[1].lower() + str(random.randint(0, 9)) + self.password[3:]

            self._log(f"✓ 密码: {self.password}")

            # 生成个人信息
            first_name, last_name = generate_random_name()
            birthdate = generate_random_birthday()
            self._log(f"✓ 姓名: {first_name} {last_name}")
            self._log(f"✓ 生日: {birthdate}")

            # Step 2: 初始化 ChatGPTClient
            self._log("[2/15] 初始化 ChatGPT 客户端...")
            client = ChatGPTClient(
                proxy=self.proxy_url,
                verbose=False,
                browser_mode="protocol"
            )
            client._log = lambda msg: self._log(f"  {msg}")

            # Step 3: 访问首页
            self._log("[3/15] 访问 ChatGPT 首页...")
            if not client.visit_homepage():
                return PaymentRegistrationResult(
                    success=False,
                    email=email,
                    password=self.password,
                    error_message="访问首页失败"
                )

            # Step 4: 获取 CSRF token
            self._log("[4/15] 获取 CSRF token...")
            csrf_token = client.get_csrf_token()
            if not csrf_token:
                return PaymentRegistrationResult(
                    success=False,
                    email=email,
                    password=self.password,
                    error_message="获取 CSRF token 失败"
                )

            # Step 5: 提交邮箱
            self._log("[5/15] 提交邮箱...")
            auth_url = client.signin(email, csrf_token)
            if not auth_url:
                return PaymentRegistrationResult(
                    success=False,
                    email=email,
                    password=self.password,
                    error_message="提交邮箱失败"
                )

            # Step 6: 授权
            self._log("[6/15] 访问 authorize URL...")
            final_url = client.authorize(auth_url)
            if not final_url:
                return PaymentRegistrationResult(
                    success=False,
                    email=email,
                    password=self.password,
                    error_message="授权失败"
                )

            # Step 7: 注册用户
            self._log("[7/15] 注册用户（提交密码）...")
            success, msg = client.register_user(email, self.password)
            if not success:
                return PaymentRegistrationResult(
                    success=False,
                    email=email,
                    password=self.password,
                    error_message=f"注册用户失败: {msg}"
                )

            # Step 8: 发送验证码
            self._log("[8/15] 发送验证码...")
            if not client.send_email_otp():
                self._log("  ⚠ 发送验证码接口返回失败，继续等待邮箱中的验证码...")

            # Step 9: 获取验证码
            self._log("[9/15] 等待验证码（最多 120 秒）...")
            otp_code = self.email_service.get_verification_code(email, timeout=120)
            if not otp_code:
                return PaymentRegistrationResult(
                    success=False,
                    email=email,
                    password=self.password,
                    error_message="未收到验证码"
                )
            self._log(f"  ✓ 收到验证码: {otp_code}")

            # Step 10: 验证验证码
            self._log("[10/15] 验证验证码...")
            success, result = client.verify_email_otp(otp_code, return_state=True)
            if not success:
                return PaymentRegistrationResult(
                    success=False,
                    email=email,
                    password=self.password,
                    error_message=f"验证码验证失败: {result}"
                )

            # Step 11: 创建账号（填写姓名和生日）
            self._log("[11/15] 创建账号（填写个人信息）...")
            success, state = client.create_account(
                first_name,
                last_name,
                birthdate,
                return_state=True
            )
            if not success:
                return PaymentRegistrationResult(
                    success=False,
                    email=email,
                    password=self.password,
                    error_message=f"创建账号失败: {state}"
                )

            # 处理创建账号后的跳转（如 identity_verification, workspace_select, external_url 等）
            if state and hasattr(state, 'page_type'):
                self._log("  处理账号创建后的跳转...")
                max_redirects = 5
                redirect_count = 0

                while redirect_count < max_redirects:
                    # 检查是否需要跳转
                    if hasattr(state, 'continue_url') and state.continue_url:
                        current_url_lower = str(state.current_url or "").lower()
                        continue_url_lower = str(state.continue_url or "").lower()
                        page_type = str(getattr(state, 'page_type', '')).lower()

                        # 如果是需要跳转的页面类型
                        if page_type == "external_url" or \
                           "workspace" in f"{continue_url_lower} {current_url_lower}" or \
                           "consent" in f"{continue_url_lower} {current_url_lower}" or \
                           "identity" in f"{continue_url_lower} {current_url_lower}":
                            self._log(f"  跳转: {state.page_type} -> {state.continue_url[:80]}...")
                            success, state = client._follow_flow_state(
                                state,
                                referer=state.current_url or f"{client.AUTH}/about-you"
                            )
                            if not success:
                                self._log(f"  ⚠ 跳转失败: {state}")
                                break
                            redirect_count += 1

                            # 如果跳转后没有更多 continue_url，说明完成了
                            if not hasattr(state, 'continue_url') or not state.continue_url:
                                self._log(f"  ✓ 跳转完成")
                                break
                            continue

                    # 没有更多跳转，退出循环
                    break

            # Step 12: 获取 session token
            self._log("[12/15] 获取 session token...")
            ok, session_data = client.fetch_chatgpt_session()
            if not ok:
                self._log(f"  ⚠ 获取 session 失败: {session_data}")
                access_token = ""
                session_token = ""
                account_id = ""
            else:
                access_token = session_data.get("accessToken", "")
                session_token = session_data.get("session_token", "")
                account_id = session_data.get("account_id", "")
                self._log("  ✓ Session token 获取成功")
                if access_token:
                    self._log(f"  ✓ Access token: {access_token[:20]}...")

            # Step 13: 获取用户国家信息
            self._log("[13/15] 获取用户国家信息...")

            # 等待一下让 session 完全生效
            time.sleep(2)

            ok, user_info = client.get_user_info()
            if not ok:
                self._log(f"  ⚠ 获取用户信息失败: {user_info}")
                self._log("  使用默认值: US / USD")
                country = "US"
                currency = "USD"
            else:
                country = user_info.get("country", "US")
                self._log(f"  ✓ 国家: {country}")

                # Step 14: 映射国家到货币
                self._log("[14/15] 映射货币...")
                currency = get_currency_for_country(country, default="USD")
                self._log(f"  ✓ 货币: {currency}")

            # Step 15: 创建支付会话（Plus + Team）
            self._log("[15/15] 创建支付会话...")

            ok, checkout_data = client.create_checkout_session(
                country,
                currency,
                "chatgptplusplan",
                access_token=access_token,
                promo_campaign_id="plus-1-month-free",
            )
            if not ok:
                self._log(f"  ⚠ 创建 Plus 支付会话失败: {checkout_data}")
                checkout_url = ""
            else:
                checkout_url = checkout_data.get("checkout_url", "")
                self._log(f"  ✓ Plus 支付链接: {checkout_url}")

            ok2, checkout_data2 = client.create_checkout_session(
                country,
                currency,
                "chatgptteamplan",
                access_token=access_token,
                promo_campaign_id="team-1-month-free",
            )
            if not ok2:
                self._log(f"  ⚠ 创建 Team 支付会话失败: {checkout_data2}")
                team_checkout_url = ""
            else:
                team_checkout_url = checkout_data2.get("checkout_url", "")
                self._log(f"  ✓ Team 支付链接: {team_checkout_url}")

            self._log("")
            self._log("="*60)
            self._log("✓ 注册流程完成！")
            self._log("="*60)
            self._log("")
            self._log("账号信息：")
            self._log(f"  邮箱: {email}")
            self._log(f"  密码: {self.password}")
            self._log(f"  地区: {country}")
            if account_id:
                self._log(f"  Account ID: {account_id}")
            if checkout_url:
                self._log(f"  Plus 支付链接: {checkout_url}")
            if team_checkout_url:
                self._log(f"  Team 支付链接: {team_checkout_url}")
            self._log("")

            return PaymentRegistrationResult(
                success=True,
                email=email,
                password=self.password,
                access_token=access_token,
                session_token=session_token,
                account_id=account_id,
                checkout_url=checkout_url,
                team_checkout_url=team_checkout_url,
                email_service_id=email_service_id,
                region=country,
            )

        except TaskInterruption:
            self._log("任务被中断", "error")
            return PaymentRegistrationResult(
                success=False,
                error_message="任务被中断"
            )
        except Exception as e:
            self._log(f"注册失败: {e}", "error")
            import traceback
            self._log(traceback.format_exc(), "error")
            return PaymentRegistrationResult(
                success=False,
                error_message=str(e)
            )
