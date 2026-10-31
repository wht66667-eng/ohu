from __future__ import annotations
import json, re
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"

UNLOCK = """() => {
  const SALT1='sunshine-campus-jou-timetable-v1';
  const SALT2='sunshine-campus-vpn-account-v1';
  const enc=(text,salt)=>{const bytes=new TextEncoder().encode(text);const out=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)out[i]=bytes[i]^(salt.charCodeAt(i%salt.length)&0xff);let bin='';out.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin)};
  localStorage.setItem('campus.gate.unlocked.v1','1');
  localStorage.setItem('campus.rememberAll.v1','1');
  localStorage.setItem('schedule.lastStuid','2026999999');
  localStorage.setItem('schedule.rememberPwd','1');
  localStorage.setItem('schedule.pwdBlob.v1',enc('smoke-test-pwd',SALT1));
  localStorage.setItem('campus.vpnPwdBlob.v1',enc('smoke-test-pwd',SALT2));
}"""

KILL_BOOT = "() => { const el=document.getElementById('boot-splash'); if(el) el.remove(); document.documentElement.classList.remove('boot-lock'); }"

def main():
    cons = []
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        c = b.new_context(viewport={"width": 390, "height": 844}, locale="zh-CN")
        page = c.new_page()
        page.on("console", lambda m: cons.append(m.text) if m.type == "error" else None)
        page.on(
            "response",
            lambda r: cons.append(f"HTTP {r.status} {r.url}")
            if r.status >= 400 and "4173" not in r.url
            else None,
        )
        page.goto(BASE + "/", wait_until="domcontentloaded")
        page.wait_for_timeout(1200)
        page.evaluate(UNLOCK)
        page.reload()
        page.wait_for_timeout(2000)
        page.evaluate(KILL_BOOT)
        try:
            page.get_by_role("button", name="暂不").click(timeout=3000)
        except Exception:
            pass

        checks = []
        for route in [
            "/",
            "/food",
            "/games",
            "/pet/explore",
            "/pet/adventure",
            "/settings",
            "/market",
            "/info",
            "/plaza",
            "/words",
            "/pet/battle",
            "/pet/campus",
            "/todo",
            "/wallet",
            "/contact",
            "/messages",
        ]:
            page.goto(BASE + route, wait_until="domcontentloaded")
            page.wait_for_timeout(1000)
            page.evaluate(KILL_BOOT)
            try:
                page.get_by_role("button", name="暂不").click(timeout=600)
            except Exception:
                pass
            page.wait_for_timeout(1200)
            text = re.sub(r"\s+", " ", page.locator("body").inner_text())
            issues = []
            if "food_snack" in text or "toy_ball" in text:
                issues.append("raw_item_id")
            if "正在同步" in text:
                issues.append("syncing")
            if "正在查询" in text:
                issues.append("cdn_query")
            if "登录后" in text:
                issues.append("needs_login")
            if "先领养" in text or "去首页领养" in text or "回首页领养" in text:
                issues.append("needs_pet")
            if "0 家" in text:
                issues.append("zero_stalls")
            for label in ["下载并解锁", "下载冒险包", "检查更新", "导出进度", "生成我的邀请码"]:
                loc = page.get_by_text(label, exact=False)
                if loc.count() and loc.first.is_visible():
                    try:
                        loc.first.click(timeout=2000)
                        page.wait_for_timeout(1500)
                        issues.append("clicked:" + label)
                        text2 = re.sub(r"\s+", " ", page.locator("body").inner_text())
                        if "失败" in text2 or "错误" in text2:
                            issues.append("after_click_error:" + label)
                    except Exception:
                        issues.append("click_fail:" + label)
            checks.append({"route": route, "issues": issues, "preview": text[:240]})

        page.goto(BASE + "/food")
        page.wait_for_timeout(6000)
        t = re.sub(r"\s+", " ", page.locator("body").inner_text())
        checks.append(
            {
                "route": "/food@6s",
                "zero": "0 家" in t,
                "syncing": "正在同步" in t,
                "empty": "还没有档口" in t,
                "preview": t[:240],
            }
        )
        print(json.dumps({"checks": checks, "net": cons[:40]}, ensure_ascii=False, indent=2))
        b.close()

if __name__ == "__main__":
    main()
