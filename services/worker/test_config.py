#!/usr/bin/env python3
"""
测试脚本 - 验证 MoeMail 集成配置
"""
import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils.crypto import decrypt_secret


def test_database_connection():
    """测试数据库连接"""
    print("1. 测试数据库连接...")
    try:
        database_url = os.getenv("DATABASE_URL") or os.getenv("ARM_DATABASE_URL")
        if not database_url:
            print("   ❌ 未设置 DATABASE_URL 环境变量")
            return False

        conn = psycopg2.connect(database_url)
        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        print(f"   ✅ 数据库连接成功: {version[:50]}...")
        cursor.close()
        conn.close()
        return True
    except Exception as e:
        print(f"   ❌ 数据库连接失败: {e}")
        return False


def test_email_provider():
    """测试邮箱提供商配置"""
    print("\n2. 测试邮箱提供商配置...")
    try:
        database_url = os.getenv("DATABASE_URL") or os.getenv("ARM_DATABASE_URL")
        conn = psycopg2.connect(database_url)
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT id, name, provider_type, api_url, api_key_ciphertext, status
            FROM email_providers
            WHERE deleted_at IS NULL
            ORDER BY is_default DESC, created_at DESC
            LIMIT 1
        """)

        provider = cursor.fetchone()
        cursor.close()
        conn.close()

        if not provider:
            print("   ❌ 未找到邮箱提供商配置")
            print("   提示: 请在 Web 界面中添加邮箱提供商")
            return False

        print(f"   ✅ 找到邮箱提供商:")
        print(f"      ID: {provider['id']}")
        print(f"      名称: {provider['name']}")
        print(f"      类型: {provider['provider_type']}")
        print(f"      API URL: {provider['api_url']}")
        print(f"      状态: {provider['status']}")

        if not provider['api_key_ciphertext']:
            print("   ❌ 未配置 API key")
            return False

        return True
    except Exception as e:
        print(f"   ❌ 查询失败: {e}")
        return False


def test_encryption():
    """测试加密解密"""
    print("\n3. 测试加密解密...")
    try:
        encryption_key = os.getenv("ARM_DATA_ENCRYPTION_KEY") or os.getenv("ARM_SESSION_SECRET")
        if not encryption_key:
            print("   ⚠️  未设置加密密钥环境变量")
            print("   提示: 设置 ARM_DATA_ENCRYPTION_KEY 或 ARM_SESSION_SECRET")
            return False

        print(f"   ✅ 加密密钥已配置 (长度: {len(encryption_key)})")

        # 尝试解密 API key
        database_url = os.getenv("DATABASE_URL") or os.getenv("ARM_DATABASE_URL")
        conn = psycopg2.connect(database_url)
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute("""
            SELECT api_key_ciphertext
            FROM email_providers
            WHERE deleted_at IS NULL AND api_key_ciphertext IS NOT NULL
            LIMIT 1
        """)

        result = cursor.fetchone()
        cursor.close()
        conn.close()

        if not result:
            print("   ⚠️  没有加密的 API key 可供测试")
            return True

        api_key = decrypt_secret(result['api_key_ciphertext'])
        print(f"   ✅ API key 解密成功 (长度: {len(api_key)})")
        return True

    except Exception as e:
        print(f"   ❌ 解密失败: {e}")
        print("   提示: 确认加密密钥与 Web 应用一致")
        return False


def test_moemail_api():
    """测试 MoeMail API 连接"""
    print("\n4. 测试 MoeMail API 连接...")
    try:
        import requests
        from utils.email_service import EmailServiceAdapter

        database_url = os.getenv("DATABASE_URL") or os.getenv("ARM_DATABASE_URL")
        adapter = EmailServiceAdapter(database_url)

        provider = adapter._get_provider()
        api_url = provider['api_url'].rstrip('/')
        api_key = provider['api_key']

        # 测试 config 端点
        response = requests.get(
            f"{api_url}/api/config",
            headers={"X-API-Key": api_key},
            timeout=10
        )

        if response.status_code == 200:
            config = response.json()
            print(f"   ✅ MoeMail API 连接成功")
            print(f"      可用域名: {config.get('emailDomains', 'N/A')}")
            print(f"      最大邮箱数: {config.get('maxEmails', 'N/A')}")
            return True
        else:
            print(f"   ❌ MoeMail API 返回错误: HTTP {response.status_code}")
            return False

    except Exception as e:
        print(f"   ❌ MoeMail API 连接失败: {e}")
        return False


def main():
    """主函数"""
    print("=" * 60)
    print("MoeMail 集成配置测试")
    print("=" * 60)

    results = []
    results.append(("数据库连接", test_database_connection()))
    results.append(("邮箱提供商", test_email_provider()))
    results.append(("加密解密", test_encryption()))
    results.append(("MoeMail API", test_moemail_api()))

    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)

    all_passed = True
    for name, passed in results:
        status = "✅ 通过" if passed else "❌ 失败"
        print(f"{name:20s} {status}")
        if not passed:
            all_passed = False

    print("=" * 60)

    if all_passed:
        print("\n🎉 所有测试通过！可以开始使用支付注册功能。")
        return 0
    else:
        print("\n⚠️  部分测试失败，请根据提示修复配置。")
        return 1


if __name__ == "__main__":
    sys.exit(main())
