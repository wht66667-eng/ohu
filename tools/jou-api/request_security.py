"""Small request boundary shared by all credential-taking routes."""
from __future__ import annotations

import ipaddress
import json
import re
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

MAX_BODY_BYTES = 8192


def client_ip(remote: str | None, forwarded: str, hops: int = 0, trusted_cidrs: str = "") -> str:
    """Honor a proxy chain only when its immediate peer and hop count are trusted.

    Forwarded headers supplied by an ordinary Internet client are never an
    identity. Trusted proxies must append the real peer and strip unsafe headers.
    """
    try:
        peer = ipaddress.ip_address(remote or "")
    except ValueError:
        return "unknown"
    if hops <= 0 or not trusted_cidrs:
        return str(peer)
    try:
        networks = [ipaddress.ip_network(c.strip()) for c in trusted_cidrs.split(",") if c.strip()]
    except ValueError:
        return str(peer)
    if not any(peer in network for network in networks):
        return str(peer)
    # Do not parse an unlimited attacker-supplied header or trust its first item.
    if len(forwarded) > 1024:
        return str(peer)
    chain = forwarded.split(",")
    if len(chain) < hops or hops > 5:
        return str(peer)
    try:
        return str(ipaddress.ip_address(chain[-hops].strip()))
    except ValueError:
        return str(peer)


def read_object(request) -> dict:
    if request.content_length is not None and request.content_length > MAX_BODY_BYTES:
        raise RequestEntityTooLarge()
    data = request.stream.read(MAX_BODY_BYTES + 1)
    if len(data) > MAX_BODY_BYTES:
        raise RequestEntityTooLarge()
    try:
        body = json.loads(data)
    except (ValueError, UnicodeError, RecursionError):
        raise BadRequest("请提交正确的 JSON 对象") from None
    if not isinstance(body, dict):
        raise BadRequest("请求内容必须为 JSON 对象")
    return body


def credential(body: dict, key: str, limit: int = 256, strip: bool = False) -> str:
    value = body.get(key, "")
    if not isinstance(value, str) or len(value) > limit or any(c in value for c in ("\x00", "\r", "\n")):
        raise BadRequest("账号、密码或验证码格式不正确")
    return value.strip() if strip else value


def fetch_targets(body: dict, defaults: list[str]) -> list[str]:
    value = body.get("fetch")
    if value is None:
        return list(defaults)
    if isinstance(value, str) and len(value) <= 64:
        value = [v.strip() for v in value.split(",") if v.strip()]
    if (not isinstance(value, list) or len(value) > 3
            or any(not isinstance(v, str) or v not in {"schedule", "grades", "exams"} for v in value)):
        raise BadRequest("请选择课表、成绩或考试查询")
    return list(dict.fromkeys(value)) or list(defaults)


def ocr_attempts(body: dict) -> int:
    value = body.get("max_tries", 5)
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,2}", value):
        value = int(value)
    if type(value) is not int:
        raise BadRequest("验证码重试次数格式不正确")
    return max(1, min(8, value))
