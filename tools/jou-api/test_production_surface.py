"""生产路由边界回归：仅使用 Flask 本机测试客户端，不请求学校或生产服务。"""
import os
import subprocess
import sys
import unittest
from pathlib import Path


class ProductionSurface(unittest.TestCase):
    def inspect(self, enabled):
        env = {**os.environ, "ENABLE_QUERY_DEMO": "1" if enabled else "0", "MOCK": "0"}
        result = subprocess.run([sys.executable, "-c", "import app; print(sorted(r.rule for r in app.app.url_map.iter_rules()))"], cwd=Path(__file__).parent, env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        import ast
        return ast.literal_eval(result.stdout.strip().splitlines()[-1])

    def test_default_routes_have_no_static_demo_or_test_entry(self):
        routes = self.inspect(False)
        self.assertIn("/api/timetable/query", routes)
        self.assertIn("/api/health", routes)
        self.assertIn("/api/integrations/capabilities", routes)
        # 体测改为设备侧同步（device-sync-only），服务端不再暴露查询/验证码路由；
        # 旧 /api/schedule 兼容入口已移除，当前前端只调用 /api/timetable/*。
        self.assertNotIn("/api/physical/query", routes)
        self.assertNotIn("/api/physical/captcha", routes)
        self.assertNotIn("/api/schedule", routes)
        self.assertFalse(any("<path:" in route or "/static" in route or "__offline" in route or "/debug" in route for route in routes), routes)

    def test_local_demo_route_requires_explicit_opt_in(self):
        self.assertIn("/<path:filename>", self.inspect(True))

    def test_image_build_retains_license_but_excludes_test_sources(self):
        text = Path(__file__).with_name(".dockerignore").read_text(encoding="utf-8")
        self.assertLess(text.index("*.md"), text.index("!THIRD_PARTY_NOTICES.md"))
        self.assertIn("test_*.py", text)
        docker = Path(__file__).with_name("Dockerfile").read_text(encoding="utf-8")
        self.assertIn("THIRD_PARTY_NOTICES.md", docker)
        self.assertNotIn("COPY . .", docker)


if __name__ == "__main__":
    unittest.main()
