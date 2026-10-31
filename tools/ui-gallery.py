# -*- coding: utf-8 -*-
"""全站界面截图：把每个路由的浅色 / 深色截图导出到指定文件夹。

用法：
  python tools/ui-gallery.py <输出目录>
（默认 C:/Users/upwar/Desktop/新建文件夹 (7)；需先起 vite preview 在 4173 端口）

说明：
- 未登录态：CloudBase 登录无法脚本化（短信验证码），除首页 / 门禁页外，
  多数页面会显示「登录后使用」的空状态，版式、导航与视觉仍完整可见。
- 深色截图进 <输出目录>/dark/。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"

# 与 src/App.tsx 的 SECONDARY_ROUTES 对齐；带参数的路由用 0 占位（会渲染缺省态）
ROUTES = [
    ("/", "home"),
    ("/services", "services"),
    ("/tasks", "tasks"),
    ("/market", "market"),
    ("/info", "info"),
    ("/food", "food"),
    ("/study/focus", "study-focus"),
    ("/study/goals", "study-goals"),
    ("/words", "words"),
    ("/words/duel", "words-duel"),
    ("/words/endless", "words-endless"),
    ("/english", "english"),
    ("/english/bank", "english-bank"),
    ("/english/exam/0", "english-exam"),
    ("/chat", "chat"),
    ("/chats", "chats"),
    ("/chats/0", "chat-room"),
    ("/schedule", "schedule"),
    ("/study", "study"),
    ("/zhongce", "zhongce"),
    ("/plaza", "plaza"),
    ("/sports", "sports"),
    ("/sports/teams", "sports-teams"),
    ("/todo", "todo"),
    ("/contact", "contact"),
    ("/messages", "messages"),
    ("/notify", "notify"),
    ("/wallet", "wallet"),
    ("/settings", "settings"),
    ("/shops", "shops"),
    ("/shop/0", "shop-detail"),
    ("/item/0", "item-detail"),
    ("/task/0", "task-detail"),
    ("/work/stall", "work-stall"),
    ("/work/rider", "work-rider"),
    ("/work/shop", "work-shop"),
    ("/partner", "partner"),
    ("/admin/roles", "admin-roles"),
    ("/admin/finance", "admin-finance"),
    ("/admin/members", "admin-members"),
    ("/admin/content", "admin-content"),
    ("/admin/news", "admin-news"),
    ("/admin/reports", "admin-reports"),
    ("/admin/partners", "admin-partners"),
]

UNLOCK_JS = """() => {
  const el = document.getElementById('boot-splash');
  if (el) el.remove();
  document.documentElement.classList.remove('boot-lock');
}"""

# 兜底：截图前把残留的弹层节点直接摘掉（比点按钮可靠）
STRIP_OVERLAYS_JS = """() => {
  document.querySelectorAll('[role="dialog"],[role="alertdialog"]').forEach((el) => el.remove());
}"""

GATE_JS = """() => {
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
  // 首跑引导（法律确认 / 权限 / 新生引导）不拦路
  localStorage.setItem('sc.firstRun.legal.v1:user', '1');
  localStorage.setItem('sc.firstRun.perms.v1:user', '1');
  localStorage.setItem('sc.firstRun.campusGuide.v1:user', '1');
  localStorage.setItem('campus.gate.unlocked.v1', '1');
  localStorage.setItem('campus.rememberAll.v1', '1');
  localStorage.setItem('schedule.lastStuid', '2026999999');
  localStorage.setItem('schedule.rememberPwd', '1');
  localStorage.setItem('schedule.pwdBlob.v1', enc('smoke-test-pwd', SALT1));
  localStorage.setItem('campus.vpnPwdBlob.v1', enc('smoke-test-pwd', SALT2));
}"""


def dismiss_overlays(page) -> None:
    """关掉全局弹层（通知权限引导、登录引导等），别让它挡在截图上。"""
    for _ in range(3):
        dismissed = False
        for label in ("暂不", "稍后再说", "以后再说", "跳过", "取消"):
            btn = page.get_by_role("button", name=re.compile(label))
            if btn.count():
                try:
                    btn.first.click(timeout=2000)
                    page.wait_for_timeout(600)
                    dismissed = True
                    break
                except Exception:
                    pass
        if not dismissed:
            break


def sanitize(text: str) -> str:
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"[^\w\u4e00-\u9fff-]", "", text)
    return text[:24] or "btn"


def crop_buttons(page, out: Path, page_slug: str) -> int:
    """把当前页面上所有可见按钮逐个裁剪成小图，返回数量。"""
    btn_dir = out / "buttons" / page_slug
    btn_dir.mkdir(parents=True, exist_ok=True)
    handles = page.query_selector_all("button, [role='button']")
    seen: set[str] = set()
    count = 0
    for idx, handle in enumerate(handles, start=1):
        try:
            if not handle.is_visible():
                continue
            box = handle.bounding_box()
            if not box or box["width"] < 16 or box["height"] < 16:
                continue
            label = (handle.inner_text() or "").strip() or (handle.get_attribute("aria-label") or "").strip()
            key = f"{label}|{round(box['width'])}x{round(box['height'])}"
            if key in seen:
                continue
            seen.add(key)
            count += 1
            name = f"{count:02d}-{sanitize(label)}.png"
            handle.screenshot(path=str(btn_dir / name))
        except Exception:
            continue
    return count


def shoot(page, out: Path, theme: str) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for i, (route, slug) in enumerate(ROUTES, start=1):
        name = f"{i:02d}-{slug}.png"
        try:
            page.goto(BASE + route, wait_until="domcontentloaded", timeout=45000)
        except Exception:
            page.wait_for_timeout(1500)
        page.wait_for_timeout(2600)
        page.evaluate(UNLOCK_JS)
        if theme == "dark":
            page.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
        # 提醒引导弹层是延迟弹出的，等它出现再关，前后各试一轮
        page.wait_for_timeout(1400)
        dismiss_overlays(page)
        page.wait_for_timeout(700)
        dismiss_overlays(page)
        page.evaluate(STRIP_OVERLAYS_JS)
        page.wait_for_timeout(500)
        target = out / name
        page.screenshot(path=str(target), full_page=True)
        body = re.sub(r"\s+", " ", page.locator("body").inner_text())[:120]
        # 按钮单独裁剪：只在浅色轮做，避免翻倍
        n_btns = 0
        if theme == "light":
            try:
                n_btns = crop_buttons(page, out, slug)
            except Exception as e:
                print(f"  buttons fail {route}: {str(e)[:80]}")
        rows.append((route, name, n_btns))
        print(f"[{theme}] {route} -> {name} ({n_btns} buttons) | {body}")
        # 回浅色，避免影响下一张
        if theme == "dark":
            page.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")
    return rows


def unlock(page) -> None:
    """种好首跑 / 门禁存储，点掉门禁，回到干净的可截图状态。"""
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2000)
    page.evaluate(GATE_JS)
    page.reload(wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2000)
    page.evaluate(UNLOCK_JS)
    # 门禁还在就点「先进入 App」
    for _ in range(10):
        btn = page.get_by_role("button", name=re.compile("先进入 App"))
        if btn.count() == 0:
            break
        try:
            btn.first.click(timeout=3000)
        except Exception:
            pass
        page.wait_for_timeout(800)
    page.evaluate(UNLOCK_JS)
    page.wait_for_timeout(500)
    dismiss_overlays(page)
    page.wait_for_timeout(400)


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\upwar\Desktop\新建文件夹 (7)")
    out.mkdir(parents=True, exist_ok=True)
    dark_out = out / "dark"
    dark_out.mkdir(exist_ok=True)

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
        unlock(page)

        light = shoot(page, out, "light")
        dark = shoot(page, dark_out, "dark")
        browser.close()

    lines = ["# 界面截图清单\n"]
    lines.append("浅色截图在本目录，深色截图在 dark/ 子目录；每页按钮逐个裁剪在 buttons/<页面名>/ 。\n")
    total_btns = 0
    for (route, name, n), (_, dname, _) in zip(light, dark):
        total_btns += n
        lines.append(f"- `{name}` / `dark/{dname}` — {route}（按钮 {n} 个）")
    lines.append(f"\n按钮截图合计 {total_btns} 张。")
    (out / "截图清单.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"done: {len(light)} pages x2 themes, {total_btns} buttons -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
