"""AI 代理凭据边界回归：仅用 Flask 本机测试客户端，不请求 Agnes 或任何上游。

锁定两条安全约束：
  1. 未配置 AGNES_API_KEY 时 fail-closed（503），且绝不触达上游；
  2. 源码不得再出现硬编码密钥兜底（凭据不入仓库）。
"""
import os
import unittest
from pathlib import Path
from unittest import mock

import app as app_module


class AiProxyCredentialBoundary(unittest.TestCase):
    def setUp(self):
        self.client = app_module.app.test_client()

    def test_missing_key_fails_closed_without_upstream(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("AGNES_API_KEY", None)
            with mock.patch(
                "requests.post",
                side_effect=AssertionError("未配置密钥时不得调用上游"),
            ) as post:
                resp = self.client.post(
                    "/api/ai",
                    json={"input": "你好"},
                    headers={"Authorization": "Bearer synthetic-token"},
                )
                self.assertEqual(resp.status_code, 503)
                self.assertEqual(resp.get_json().get("code"), "MODEL_UNAVAILABLE")
                post.assert_not_called()

    def test_invalid_input_rejected(self):
        resp = self.client.post(
            "/api/ai",
            json={"input": 123},
            headers={"Authorization": "Bearer synthetic-token"},
        )
        self.assertEqual(resp.status_code, 400)

    def test_missing_bearer_rejected(self):
        resp = self.client.post("/api/ai", json={"input": "你好"})
        self.assertEqual(resp.status_code, 401)

    def test_source_has_no_hardcoded_key_fallback(self):
        text = Path(app_module.__file__).read_text(encoding="utf-8")
        self.assertNotRegex(text, r'or\s+"sk-')
        self.assertNotRegex(text, r'=\s*"sk-[A-Za-z0-9]{20,}"')


if __name__ == "__main__":
    unittest.main()