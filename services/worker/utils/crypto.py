"""
加密工具 - 用于解密数据库中的敏感信息
"""
import os
import hashlib
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend


def get_encryption_key() -> bytes:
    """获取加密密钥"""
    source = (
        os.getenv("ARM_DATA_ENCRYPTION_KEY") or
        os.getenv("ARM_SESSION_SECRET") or
        "arm-local-data-encryption-key-change-me"
    )
    return hashlib.sha256(source.encode()).digest()


def decrypt_secret(encrypted: str) -> str:
    """
    解密加密的密钥
    格式: v1.{iv_base64url}.{auth_tag_base64url}.{ciphertext_base64url}
    """
    parts = encrypted.split(".")

    if len(parts) != 4 or parts[0] != "v1":
        raise ValueError("Invalid encrypted format")

    _, iv_base64, auth_tag_base64, ciphertext_base64 = parts

    # 解码 base64url
    iv = base64.urlsafe_b64decode(iv_base64 + "==")
    auth_tag = base64.urlsafe_b64decode(auth_tag_base64 + "==")
    ciphertext = base64.urlsafe_b64decode(ciphertext_base64 + "==")

    # 使用 AES-256-GCM 解密
    key = get_encryption_key()
    aesgcm = AESGCM(key)

    # 组合 ciphertext 和 auth_tag
    encrypted_data = ciphertext + auth_tag

    try:
        decrypted = aesgcm.decrypt(iv, encrypted_data, None)
        return decrypted.decode('utf-8')
    except Exception as e:
        raise ValueError(f"Decryption failed: {e}")
