#!/usr/bin/env python3
"""
测试默认邮箱提供商功能
"""
import os
import sys
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def test_default_provider():
    """测试默认提供商选择逻辑"""
    print("=" * 60)
    print("测试默认邮箱提供商功能")
    print("=" * 60)

    database_url = os.getenv("DATABASE_URL") or os.getenv("ARM_DATABASE_URL")
    if not database_url:
        print("❌ 未设置 DATABASE_URL 环境变量")
        return False

    try:
        conn = psycopg2.connect(database_url)
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # 1. 查看所有提供商
        print("\n1. 所有邮箱提供商:")
        print("-" * 60)
        cursor.execute("""
            SELECT id, name, provider_type, status, is_default, created_at
            FROM email_providers
            WHERE deleted_at IS NULL
            ORDER BY is_default DESC, created_at DESC
        """)

        providers = cursor.fetchall()
        if not providers:
            print("   ⚠️  没有配置邮箱提供商")
            print("   提示: 请在 Web 界面添加邮箱提供商")
            return False

        for p in providers:
            default_mark = "✅ [默认]" if p['is_default'] else "   "
            status_mark = "🟢" if p['status'] == 'active' else "🔴"
            print(f"   {default_mark} {status_mark} ID:{p['id']} {p['name']} ({p['provider_type']})")

        # 2. 测试默认选择逻辑
        print("\n2. 测试默认选择逻辑:")
        print("-" * 60)

        # 模拟不指定 provider_id 的情况
        cursor.execute("""
            SELECT id, name, provider_type, is_default
            FROM email_providers
            WHERE deleted_at IS NULL AND status = 'active'
            ORDER BY is_default DESC, created_at DESC
            LIMIT 1
        """)

        selected = cursor.fetchone()
        if selected:
            print(f"   ✅ 自动选择: {selected['name']} (ID: {selected['id']})")
            if selected['is_default']:
                print(f"   ✅ 原因: 设置为默认提供商")
            else:
                print(f"   ⚠️  原因: 没有默认提供商，选择最新的活跃提供商")
        else:
            print("   ❌ 没有可用的提供商")
            return False

        # 3. 检查是否有多个默认提供商
        print("\n3. 检查默认提供商配置:")
        print("-" * 60)
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM email_providers
            WHERE deleted_at IS NULL AND is_default = true
        """)

        default_count = cursor.fetchone()['count']
        if default_count == 0:
            print("   ⚠️  没有设置默认提供商")
            print("   建议: 在 Web 界面设置一个默认提供商")
        elif default_count == 1:
            print("   ✅ 已设置 1 个默认提供商（推荐）")
        else:
            print(f"   ⚠️  设置了 {default_count} 个默认提供商")
            print("   建议: 只保留一个默认提供商")

        # 4. 显示使用统计
        print("\n4. 使用统计:")
        print("-" * 60)
        cursor.execute("""
            SELECT
                name,
                total_mailboxes_created,
                last_used_at
            FROM email_providers
            WHERE deleted_at IS NULL
            ORDER BY is_default DESC, total_mailboxes_created DESC
        """)

        stats = cursor.fetchall()
        for s in stats:
            last_used = s['last_used_at'].strftime('%Y-%m-%d %H:%M') if s['last_used_at'] else '从未使用'
            print(f"   {s['name']}: 已创建 {s['total_mailboxes_created']} 个邮箱, 最后使用: {last_used}")

        cursor.close()
        conn.close()

        print("\n" + "=" * 60)
        print("✅ 测试完成")
        print("=" * 60)

        return True

    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        return False


if __name__ == "__main__":
    success = test_default_provider()
    sys.exit(0 if success else 1)
