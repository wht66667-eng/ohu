# -*- coding: utf-8 -*-
"""
验证码 OCR（ddddocr，可选依赖）

安装：pip install ddddocr
未安装时 auto 接口返回 code=1010，前端回退到手输验证码。
"""
from __future__ import annotations

import logging
import re
import threading

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_ocr = None
_ocr_tried = False
_ocr_err = ""


def ocr_available() -> bool:
    _ensure()
    return _ocr is not None


def ocr_status() -> dict:
    _ensure()
    return {
        "ready": _ocr is not None,
        "engine": "ddddocr" if _ocr is not None else None,
        "error": _ocr_err or None,
    }


def _ensure() -> None:
    global _ocr, _ocr_tried, _ocr_err
    if _ocr_tried:
        return
    with _lock:
        if _ocr_tried:
            return
        _ocr_tried = True
        try:
            import ddddocr  # type: ignore

            # show_ad=False 避免控制台广告；老版本无此参数则退回默认
            try:
                _ocr = ddddocr.DdddOcr(show_ad=False)
            except TypeError:
                _ocr = ddddocr.DdddOcr()
            logger.info("验证码 OCR 已就绪 (ddddocr)")
        except Exception as e:
            _ocr = None
            _ocr_err = str(e)[:200]
            logger.warning("验证码 OCR 不可用：%s（auto 接口将提示前端手输验证码）", _ocr_err)


def solve_captcha_image(image_bytes: bytes) -> str:
    """识别验证码图片字节，返回清洗后的字符串；失败抛 ValueError。"""
    _ensure()
    if _ocr is None:
        raise ValueError(_ocr_err or "OCR 未安装")
    if not image_bytes:
        raise ValueError("空验证码图片")
    raw = _ocr.classification(image_bytes)
    text = re.sub(r"[^0-9A-Za-z]", "", str(raw or "")).strip()
    if len(text) < 3:
        raise ValueError(f"识别结果过短: {raw!r}")
    return text
