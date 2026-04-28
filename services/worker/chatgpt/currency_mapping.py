"""
国家代码到货币代码的映射
"""

# 国家代码 -> 货币代码映射表
COUNTRY_TO_CURRENCY = {
    # 欧元区
    "AT": "EUR", "BE": "EUR", "CY": "EUR", "EE": "EUR", "FI": "EUR",
    "FR": "EUR", "DE": "EUR", "GR": "EUR", "IE": "EUR", "IT": "EUR",
    "LV": "EUR", "LT": "EUR", "LU": "EUR", "MT": "EUR", "NL": "EUR",
    "PT": "EUR", "SK": "EUR", "SI": "EUR", "ES": "EUR",

    # 主要国家
    "US": "USD",  # 美国
    "GB": "GBP",  # 英国
    "JP": "JPY",  # 日本
    "CN": "CNY",  # 中国
    "CA": "CAD",  # 加拿大
    "AU": "AUD",  # 澳大利亚
    "NZ": "NZD",  # 新西兰
    "CH": "CHF",  # 瑞士
    "SE": "SEK",  # 瑞典
    "NO": "NOK",  # 挪威
    "DK": "DKK",  # 丹麦
    "PL": "PLN",  # 波兰
    "CZ": "CZK",  # 捷克
    "HU": "HUF",  # 匈牙利
    "RO": "RON",  # 罗马尼亚
    "BG": "BGN",  # 保加利亚
    "HR": "HRK",  # 克罗地亚
    "RU": "RUB",  # 俄罗斯
    "TR": "TRY",  # 土耳其
    "IN": "INR",  # 印度
    "BR": "BRL",  # 巴西
    "MX": "MXN",  # 墨西哥
    "AR": "ARS",  # 阿根廷
    "CL": "CLP",  # 智利
    "CO": "COP",  # 哥伦比亚
    "PE": "PEN",  # 秘鲁
    "ZA": "ZAR",  # 南非
    "KR": "KRW",  # 韩国
    "TW": "TWD",  # 台湾
    "HK": "HKD",  # 香港
    "SG": "SGD",  # 新加坡
    "MY": "MYR",  # 马来西亚
    "TH": "THB",  # 泰国
    "ID": "IDR",  # 印度尼西亚
    "PH": "PHP",  # 菲律宾
    "VN": "VND",  # 越南
    "IL": "ILS",  # 以色列
    "SA": "SAR",  # 沙特阿拉伯
    "AE": "AED",  # 阿联酋
    "EG": "EGP",  # 埃及
    "NG": "NGN",  # 尼日利亚
    "KE": "KES",  # 肯尼亚
}


def get_currency_for_country(country_code: str, default: str = "USD") -> str:
    """
    根据国家代码获取货币代码

    Args:
        country_code: 国家代码（如 'NL', 'US'）
        default: 默认货币代码，当找不到映射时使用

    Returns:
        货币代码（如 'EUR', 'USD'）
    """
    if not country_code:
        return default

    country_code = country_code.upper()
    return COUNTRY_TO_CURRENCY.get(country_code, default)
