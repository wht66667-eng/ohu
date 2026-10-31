"""Feature smoke: enter via CampusGate skip, then walk student routes."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"
OUT = Path(__file__).resolve().parent / "_smoke_out"
OUT.mkdir(exist_ok=True)

ROUTES = [
    "/",
    "/services",
    "/tasks",
    "/market",
    "/info",
    "/food",
    "/profile",
    "/pet",
    "/pet/mine",
    "/pet/bag",
    "/pet/dex",
    "/pet/care",
    "/pet/library",
    "/pet/campus",
    "/pet/explore",
    "/pet/battle",
    "/pet/adventure",
    "/pet/focus",
    "/pet/charity",
    "/words",
    "/words/duel",
    "/words/endless",
    "/games",
    "/chat",
    "/chats",
    "/schedule",
    "/study",
    "/zhongce",
    "/plaza",
    "/todo",
    "/contact",
    "/messages",
    "/notify",
    "/wallet",
    "/settings",
    "/shops",
    "/partner",
]

EXPECT = {
    "/": ["学业", "课表", "待办", "服务", "阳光"],
    "/services": ["服务", "学业", "课表"],
    "/tasks": ["任务", "互助", "校园"],
    "/market": ["二手", "闲置", "元", "发布"],
    "/info": ["信息", "公告", "互助", "组队"],
    "/food": ["食堂", "盖饭", "档口", "订单"],
    "/profile": ["我的", "设置", "登录", "钱包"],
    "/pet": ["宠物", "领养", "登录", "阿狐", "冒险", "Petdex", "狐狸"],
    "/pet/mine": ["宠物", "登录", "领养", "签到", "档案"],
    "/pet/bag": ["背包", "碎片", "道具", "登录"],
    "/pet/dex": ["图鉴", "精灵", "解锁"],
    "/pet/care": ["照料", "喂养", "互动", "抚摸", "登录"],
    "/pet/library": ["图鉴", "图书馆", "精灵"],
    "/pet/campus": ["校园", "打卡", "定位", "冒险", "场景", "围栏"],
    "/pet/explore": ["探索", "备份", "碎片", "进度", "白名单"],
    "/pet/battle": ["对战", "编队", "邀请", "冒险"],
    "/pet/adventure": ["冒险", "下载", "连云港", "刷怪"],
    "/pet/focus": ["专注", "分钟", "开始"],
    "/pet/charity": ["公益", "猫", "敬请期待"],
    "/words": ["单词", "计划", "四六级", "无尽", "朗读"],
    "/words/duel": ["对决", "单词", "开始", "题"],
    "/words/endless": ["无尽", "单词", "开始"],
    "/games": ["港城", "游戏", "下载", "遗产", "街机"],
    "/chat": ["阿狐", "聊天", "发送", "消息"],
    "/chats": ["会话", "消息", "聊天", "暂无"],
    "/schedule": ["课表", "教务", "同步", "周"],
    "/study": ["学业", "成绩", "考试", "四六级"],
    "/zhongce": ["综测", "学院", "加分"],
    "/plaza": ["广场", "动态", "发布"],
    "/todo": ["待办", "添加", "完成"],
    "/contact": ["通讯", "联系", "同学"],
    "/messages": ["消息", "通知"],
    "/notify": ["通知", "消息"],
    "/wallet": ["钱包", "余额", "明细", "登录"],
    "/settings": ["设置", "主题", "版本", "更新", "提醒"],
    "/shops": ["小店", "街", "店"],
    "/partner": ["合伙", "申请", "小店"],
}


def enter_app(page) -> None:
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2000)
    # force-remove boot splash if stuck
    page.evaluate(
        """() => {
      const el = document.getElementById('boot-splash');
      if (el) el.remove();
      document.documentElement.classList.remove('boot-lock');
    }"""
    )
    page.wait_for_timeout(400)

    # fill campus gate if present
    gate = page.get_by_role("dialog", name=re.compile("校园"))
    if gate.count() == 0:
        # fallback by text
        if page.get_by_text("阳光校园").count() == 0:
            return
    # fill inputs
    stuid = page.locator('input[placeholder*="2023"], input[placeholder*="学号"], input').first
    # more reliable: labels
    inputs = page.locator("form input")
    # find password-like
    page.locator('input[placeholder*="例如"]').fill("2026999999")
    page.locator('input[type="password"], input[placeholder*="教务"]').first.fill("smoke-test-pwd")
    btn = page.get_by_role("button", name=re.compile("先进入 App"))
    btn.click(timeout=5000)
    # wait gate gone or timeout
    page.wait_for_timeout(2500)
    for _ in range(20):
        if page.get_by_role("button", name=re.compile("先进入 App")).count() == 0:
            break
        # login may hang on network
        page.wait_for_timeout(500)
    page.evaluate(
        """() => {
      const el = document.getElementById('boot-splash');
      if (el) el.remove();
    }"""
    )
    page.wait_for_timeout(500)


def main() -> int:
    results = []
    interactions = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            locale="zh-CN",
        )
        page = context.new_page()
        console_all: list[dict] = []
        page.on(
            "console",
            lambda msg: console_all.append({"type": msg.type, "text": msg.text, "url": page.url})
            if msg.type == "error"
            else None,
        )
        page_errors: list[dict] = []
        page.on("pageerror", lambda exc: page_errors.append({"error": str(exc), "url": page.url}))

        enter_app(page)
        page.screenshot(path=str(OUT / "_after_enter.png"), full_page=False)
        after = re.sub(r"\s+", " ", page.locator("body").inner_text())[:300]
        (OUT / "_after_enter.txt").write_text(after, encoding="utf-8")

        still_gate = "先进入 App，课表稍后同步" in after
        if still_gate:
            # try force unlock via evaluate using app modules? can't.
            # manually set storage using same obfuscation as app via page JS copied logic
            page.evaluate(
                """() => {
              const SALT1 = 'sunshine-campus-jou-timetable-v1';
              const SALT2 = 'sunshine-campus-vpn-account-v1';
              const enc = (text, salt) => {
                const bytes = new TextEncoder().encode(text);
                const out = new Uint8Array(bytes.length);
                for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ (salt.charCodeAt(i % salt.length) & 0xff);
                let bin = '';
                out.forEach(b => bin += String.fromCharCode(b));
                return btoa(bin);
              };
              localStorage.setItem('campus.gate.unlocked.v1', '1');
              localStorage.setItem('campus.rememberAll.v1', '1');
              localStorage.setItem('schedule.lastStuid', '2026999999');
              localStorage.setItem('schedule.rememberPwd', '1');
              localStorage.setItem('schedule.pwdBlob.v1', enc('smoke-test-pwd', SALT1));
              localStorage.setItem('campus.vpnPwdBlob.v1', enc('smoke-test-pwd', SALT2));
            }"""
            )
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            page.evaluate(
                """() => {
              const el = document.getElementById('boot-splash');
              if (el) el.remove();
              document.documentElement.classList.remove('boot-lock');
            }"""
            )
            page.wait_for_timeout(800)
            page.screenshot(path=str(OUT / "_after_force.png"), full_page=False)

        for route in ROUTES:
            before_err = len(page_errors)
            before_con = len(console_all)
            try:
                resp = page.goto(BASE + route, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(900)
                page.evaluate(
                    """() => {
                  const el = document.getElementById('boot-splash');
                  if (el) el.remove();
                }"""
                )
                page.wait_for_timeout(400)
            except Exception as e:
                results.append({"route": route, "status": "nav_fail", "note": str(e)[:200], "hits": []})
                continue

            for sel in ["text=知道了", "text=我知道了", "text=关闭", "text=稍后再说"]:
                try:
                    loc = page.locator(sel).first
                    if loc.count() and loc.is_visible(timeout=200):
                        loc.click(timeout=500)
                except Exception:
                    pass

            text = page.locator("body").inner_text(timeout=5000)
            compact = re.sub(r"\s+", " ", text).strip()
            keys = EXPECT.get(route, [])
            hits = [k for k in keys if k in compact]
            new_errs = page_errors[before_err:]
            new_cons = [c for c in console_all[before_con:] if "favicon" not in c["text"].lower()]

            status = "ok"
            note = ""
            if "先进入 App，课表稍后同步" in compact:
                status = "still_gated"
                note = "campus gate"
            elif new_errs:
                status = "pageerror"
                note = new_errs[0]["error"][:220]
            elif keys and not hits:
                status = "content_miss"
                note = f"none of {keys}"
            elif keys and len(hits) < max(1, (len(keys) + 2) // 3):
                status = "weak_content"
                note = f"hits={hits}"

            shot = OUT / (route.strip("/").replace("/", "_") or "home")
            try:
                page.screenshot(path=str(shot) + ".png", full_page=False)
            except Exception:
                pass

            results.append(
                {
                    "route": route,
                    "http": resp.status if resp else None,
                    "status": status,
                    "note": note,
                    "hits": hits,
                    "body_preview": compact[:200],
                    "console": [c["text"][:160] for c in new_cons[:5]],
                    "page_errors": [e["error"][:200] for e in new_errs[:3]],
                }
            )

        # Interactions
        for route, click_text in [
            ("/todo", "添加"),
            ("/pet/focus", "开始"),
            ("/games", "下载"),
            ("/pet/adventure", "下载"),
            ("/settings", "检查更新"),
            ("/pet/explore", "导出"),
            ("/info", "发布"),
            ("/market", "发布"),
            ("/words/duel", "开始"),
            ("/pet/battle", "生成"),
        ]:
            page.goto(BASE + route, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(700)
            page.evaluate("() => { const el=document.getElementById('boot-splash'); if(el) el.remove(); }")
            page.wait_for_timeout(300)
            before = len(page_errors)
            clicked = False
            err = ""
            try:
                loc = page.get_by_text(click_text, exact=False).first
                if loc.is_visible(timeout=2000):
                    loc.click(timeout=2500)
                    clicked = True
                    page.wait_for_timeout(900)
            except Exception as e:
                err = str(e)[:120]
            crashed = page_errors[before:]
            interactions.append(
                {
                    "route": route,
                    "action": click_text,
                    "clicked": clicked,
                    "ok": not crashed,
                    "err": crashed[0]["error"][:160] if crashed else err,
                    "body": re.sub(r"\s+", " ", page.locator("body").inner_text())[:180],
                }
            )

        browser.close()

    report = {"results": results, "interactions": interactions, "page_errors": page_errors, "console": console_all[:50]}
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    bad = [r for r in results if r["status"] not in ("ok", "weak_content")]
    weak = [r for r in results if r["status"] == "weak_content"]
    bad_ix = [i for i in interactions if not i["ok"] or not i.get("clicked")]
    print(f"ROUTES {len(results)} BAD {len(bad)} WEAK {len(weak)}")
    for r in bad + weak:
        print(f"  {r['status'].upper()} {r['route']} :: {r.get('note')} :: hits={r.get('hits')} :: {r.get('body_preview','')[:90]}")
    print("INTERACTIONS:")
    for i in interactions:
        flag = "OK" if i["ok"] and i["clicked"] else ("CRASH" if not i["ok"] else "NOCLICK")
        print(f"  {flag} {i['route']} [{i['action']}] :: {i.get('err','')[:80]} :: {i.get('body','')[:70]}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
