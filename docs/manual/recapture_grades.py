# -*- coding: utf-8 -*-
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(r"C:\Users\upwar\Desktop\xm-main\docs\manual\shots")
BASE = "http://127.0.0.1:5173"

GRADES = (
    '[{"year":"2025-2026","term":"1","code":"B1","name":"大学英语(三)","nature":"必修",'
    '"credit":"4.0","score":"86","gpa":"3.6"},'
    '{"year":"2025-2026","term":"2","code":"B2","name":"海洋概论","nature":"必修",'
    '"credit":"2.0","score":"92","gpa":"4.0"}]'
)
EXAMS = (
    '[{"year":"2025-2026","term":"2","code":"E01","name":"流体力学",'
    '"datetime":"2026-06-18 09:00-11:00","room":"C文思409","form":"闭卷",'
    '"seat":"12","campus":"苍梧","teacher":"王老师"}]'
)


def kill_splash(page):
    page.evaluate(
        "() => { const s = document.getElementById('boot-splash'); if (s) s.remove(); }"
    )


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 980, "height": 920},
            device_scale_factor=2,
            locale="zh-CN",
        )
        page = ctx.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded")
        page.wait_for_timeout(1000)
        kill_splash(page)
        skip = page.get_by_role("button", name="先进入 App，课表稍后同步")
        if skip.count() and skip.first.is_visible():
            page.get_by_placeholder("例如 2023123456").fill("2099000001")
            page.locator('input[type="password"]').first.fill("demo-pass")
            skip.click()
            page.wait_for_timeout(1500)
        page.evaluate(
            f"() => {{ localStorage.setItem('study.grades.cache.v1', {GRADES!r});"
            f" localStorage.setItem('study.exams.cache.v1', {EXAMS!r}); }}"
        )
        for path, name, sel in [
            ("/study?tab=grades", "04-study-grades", "教务成绩"),
            ("/study?tab=exams", "05-study-exams", "考试安排"),
        ]:
            page.goto(BASE + path, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)
            kill_splash(page)
            page.get_by_text(sel).first.scroll_into_view_if_needed()
            page.wait_for_timeout(400)
            page.locator('div[class*="phone"]').first.screenshot(path=str(OUT / f"{name}.png"))
            print("ok", name, (OUT / f"{name}.png").stat().st_size)
        browser.close()


if __name__ == "__main__":
    main()
