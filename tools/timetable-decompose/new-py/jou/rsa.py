# -*- coding: utf-8 -*-
"""【模块】正方前端 RSA（PKCS#1 v1.5，与页面 RSA.js 精确一致）· 原 jou_client.py 第 78-110 行"""
from __future__ import annotations

import random


def zf_rsa_encrypt(password: str, e_hex: str, n_hex: str) -> str:
    """
    移植自教务系统页面 RSA.js（TYF 版）：
      digitSize = 2*biHighIndex(n)+2（字节），chunkSize = digitSize-11
      明文按字符倒序放入块首，之后 0x00、随机非零填充、0x02、0x00
      整块按小端 16 位数字组装 → raw RSA → 大写十六进制
    """
    n_int, e_int = int(n_hex, 16), int(e_hex, 16)
    high = (n_int.bit_length() - 1) // 16          # biHighIndex
    digit_size = 2 * high + 2
    chunk_size = digit_size - 11

    # 页面用 charCodeAt；教务密码通常为 ASCII。含非 ASCII 时退化为 UTF-8 字节序列
    if any(ord(c) > 255 for c in password):
        a = list(password.encode("utf-8"))
    else:
        a = [ord(c) for c in password]

    msg_length = min(chunk_size, len(a))
    b = [0] * digit_size
    for x in range(msg_length):                    # 明文倒序
        b[x] = a[msg_length - 1 - x]
    b[msg_length] = 0                              # 0x00 分隔
    padded_size = max(8, digit_size - 3 - msg_length)
    for x in range(padded_size):                   # 随机非零填充
        b[msg_length + 1 + x] = random.randint(1, 254)
    b[digit_size - 2] = 2                          # PKCS#1 类型标记
    b[digit_size - 1] = 0

    m = int.from_bytes(bytes(b), "little")
    return format(pow(m, e_int, n_int), "X")
