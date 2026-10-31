# -*- coding: utf-8 -*-
"""Capture phone-frame screenshots for the user manual."""
from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5173"
OUT = Path(r"C:\Users\upwar\Desktop\xm-main\docs\manual\shots")
OUT.mkdir(parents=True, exist_ok=True)

GRADES = [
    {
        "year": "2025-2026",
        "term": "1",
        "code": "B00001",
        "name": "大学英语(三)",
        "nature": "必修",
        "credit": "4.0",
        "score": "86",
        "gpa": "3.6",
    },
    {
        "year": "2025-2026",
        "term": "2",
        "code": "B00003",
        "name": "海洋概论",
        "nature": "必修",
        "credit": "2.0",
        "score": "92",
        "gpa": "4.0",
    },
]
EXAMS = [
    {
        "year": "2025-2026",
        "term": "2",
        "code": "E01",
        "name": "流体力学",
        "datetime": "2026-06-18 09:00-11:00",
        "room": "C文思409",
        "form": "闭卷",
        "seat": "12",
        "campus": "苍梧",
        "teacher": "王老师",
    }
]
CERTS = [
    {
        "certId": "cet4",
        "name": "英语四级 CET-4",
        "date": "2026-12-13",
        "note": "四六级",
        "savedAt": "2026-09-26T00:00:00.000Z",
    }
]


def js_str(obj) -> str:
    return json.dumps(json.dumps(obj, ensure_ascii=False))


def seed_academic(page):
    page.evaluate(
        f"""() => {{
          localStorage.setItem('study.grades.cache.v1', {js_str(GRADES)});
          localStorage.setItem('study.exams.cache.v1', {js_str(EXAMS)});
          localStorage.setItem('study.cert-reminders.v1', {js_str(CERTS)});
          localStorage.setItem('study.academic.meta.v1', {js_str({
              "stuid": "2099000001",
              "savedAt": "2026-09-26T12:00:00.000Z"
          })});
          localStorage.setItem('notify.consent.asked.v1', '1');
          localStorage.setItem('notify.consent.granted.v1', '0');
        }}"""
    )


def kill_splash(page):
    page.evaluate(
        """() => {
          const splash = document.getElementById('boot-splash');
          if (splash) splash.remove();
          document.documentElement.classList.add('boot-ready');
        }"""
    )


def enter_app(page):
    """Fill CampusGate and skip sync so inner routes are visible."""
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1200)
    kill_splash(page)
    page.wait_for_timeout(400)

    # Capture gate first (before unlock)
    phone = page.locator('div[class*="phone"]').first
    if phone.count():
        phone.screenshot(path=str(OUT / "00-campus-gate.png"))
        print("saved 00-campus-gate.png")

    # Fill credentials
    page.get_by_placeholder("例如 2023123456").fill("2099000001")
    # password input may be type=password
    pwd = page.locator('input[type="password"]').first
    if pwd.count():
        pwd.fill("demo-pass-virtual")
    else:
        page.get_by_placeholder("正方教务密码").fill("demo-pass-virtual")

    btn = page.get_by_role("button", name="先进入 App，课表稍后同步")
    btn.click()
    page.wait_for_timeout(2000)
    kill_splash(page)
    seed_academic(page)
    # reload once so academic caches apply to StudyHub initial state
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(1500)
    kill_splash(page)
    for label in ("暂不", "知道了"):
        try:
            b = page.get_by_role("button", name=label)
            if b.count() and b.first.is_visible():
                b.first.click(timeout=500)
        except Exception:
            pass
    page.wait_for_timeout(500)


def dismiss_soft(page):
    kill_splash(page)
    for label in ("暂不", "知道了"):
        try:
            b = page.get_by_role("button", name=label)
            if b.count() and b.first.is_visible():
                b.first.click(timeout=400)
        except Exception:
            pass


def shot(page, name: str):
    dismiss_soft(page)
    page.wait_for_timeout(500)
    path = OUT / f"{name}.png"
    phone = page.locator('div[class*="phone"]').first
    phone.wait_for(state="visible", timeout=15000)
    phone.screenshot(path=str(path))
    print("saved", path.name, path.stat().st_size)


def go(page, path: str):
    page.goto(BASE + path, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(1200)
    dismiss_soft(page)
    page.wait_for_timeout(400)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 980, "height": 920},
            device_scale_factor=2,
            locale="zh-CN",
        )
        page = context.new_page()
        enter_app(page)
        shot(page, "01-home")

        for path, name in [
            ("/services", "02-services"),
            ("/study", "03-study-home"),
            ("/study?tab=grades", "04-study-grades"),
            ("/study?tab=exams", "05-study-exams"),
            ("/study?tab=certs", "06-study-certs"),
            ("/schedule", "08-schedule"),
            ("/plaza", "09-plaza"),
            ("/settings", "10-settings"),
            ("/admin/members", "11-admin-members"),
            ("/profile", "12-profile"),
        ]:
            go(page, path)
            shot(page, name)

        go(page, "/study?tab=certs")
        try:
            page.locator("button", has_text="虚拟账号试响").first.click(timeout=8000)
            page.wait_for_timeout(1000)
            shot(page, "07-cert-alert")
        except Exception as e:
            print("cert alert skip:", e)

        browser.close()

    print("done")
    for f in sorted(OUT.glob("*.png")):
        print(f.name, f.stat().st_size)


if __name__ == "__main__":
    main()
