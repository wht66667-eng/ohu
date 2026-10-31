# -*- coding: utf-8 -*-
"""Read-only browser QA of the labelled, synthetic homepage preview.

Start: node node_modules/vite/bin/vite.js --config vite.ui-review.config.ts
Run: python tools/home-brand-qa.py --iteration iteration-1
No production origin is allowed, no credentials are used, and no backend is written.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:43127/ui-review-preview.html#/"
SCENARIOS = ("signed", "guest", "empty", "error", "slow")


def assert_width(page):
    sizes = page.evaluate("""() => {
      const nodes = [document.documentElement, document.body,
        document.querySelector('[data-home-preview-phone]'),
        document.querySelector('[data-home-preview-main]')];
      return nodes.filter(Boolean).map(e => ({name: e.tagName + '.' + e.className,
        client: e.clientWidth, scroll: e.scrollWidth}));
    }""")
    assert all(row["scroll"] <= row["client"] + 1 for row in sizes), sizes
    return sizes


def select_scenario(page, value):
    page.locator(".ui-review-controls").evaluate("el => el.open = true")
    page.get_by_label("首页合成状态", exact=True).select_option(value)
    page.locator(".ui-review-controls").evaluate("el => el.open = false")


def screenshot(page, path):
    # Keep the visible "真实组件 / 本地样例" label in every delivery screenshot.
    page.screenshot(path=str(path), full_page=True, animations="disabled")


def assert_touch_height(phone):
    controls = phone.locator("a,button").evaluate_all("""els => els.map(e => ({
      text: (e.ariaLabel || e.innerText).trim(),
      height: e.getBoundingClientRect().height
    })).filter(e => e.height > 0)""")
    short = [control for control in controls if control["height"] < 43.9]
    assert not short, short
    return {"count": len(controls), "minimumHeight": min(control["height"] for control in controls)}


def choose_theme(page, main_region, theme):
    main_region.get_by_role("button", name="快捷设置", exact=True).click()
    dialog = page.get_by_role("dialog", name="快捷设置", exact=True)
    expect(dialog).to_be_visible()
    dialog.get_by_role("button", name=theme, exact=True).click()
    dialog.get_by_role("button", name="关闭快捷设置", exact=True).click()
    expect(dialog).to_be_hidden()


def dark_recheck(output):
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for width in (390, 430):
            context = browser.new_context(viewport={"width": width, "height": 1240},
                                          device_scale_factor=1, reduced_motion="reduce")
            external, errors = [], []
            def local_only(route):
                parsed = urlparse(route.request.url)
                if parsed.scheme in ("data", "blob") or (parsed.hostname == "127.0.0.1" and parsed.port == 43127):
                    route.continue_()
                else:
                    external.append(route.request.url)
                    route.abort()
            context.route("**/*", local_only)
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(BASE, wait_until="networkidle")
            page.add_style_tag(content=f".ui-review-shell {{ width: min({width}px, 100%); }}")
            expect(page.get_by_text("真实组件 / 本地样例，不是在线验收", exact=True)).to_be_visible()
            main_region = page.locator("[data-home-preview-main]")
            main_region.get_by_role("button", name="调整", exact=True).click()
            dialog = page.get_by_role("dialog", name="调整常用功能", exact=True)
            picker = dialog.locator('[aria-label="选择常用功能"]')
            for name in ("跑腿", "二手", "番茄专注"):
                picker.get_by_role("button", name=name, exact=True).click()
            dialog.get_by_role("button", name="保存调整", exact=True).click()
            expect(dialog).to_be_hidden()
            assets = []
            for name in ("tasks", "market", "focus"):
                img = main_region.locator(f'img[src="/brand/ohu-original/icon-{name}.webp"]')
                img.scroll_into_view_if_needed()
                expect(img).to_have_js_property("complete", True)
                size = img.evaluate("e => ({width:e.naturalWidth,height:e.naturalHeight})")
                assert size["width"] > 0, name
                assets.append({"name": name, **size})
            main_region.evaluate("el => el.scrollTop = 0")
            choose_theme(page, main_region, "深色")
            screenshot(page, output / f"{width}-dark.png")
            main_region.evaluate("el => el.scrollTop = el.scrollHeight")
            screenshot(page, output / f"{width}-dark-lower.png")
            colors = main_region.get_by_role("button", name="调整", exact=True).evaluate("e => ({color:getComputedStyle(e).color,bg:getComputedStyle(e.closest('section')).backgroundColor})")
            assert colors["color"] == "rgb(239, 197, 143)", colors
            results.append({"width": width, "assets": assets, "colors": colors, "sizes": assert_width(page),
                            "touch": assert_touch_height(page.locator('[data-home-preview-phone]'))})
            assert not errors, errors
            assert not external, external
            context.close()
        browser.close()
    report = {"passed": True, "syntheticOnly": True, "cases": results}
    (output / "dark-recheck.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": True, "darkWidths": [390, 430], "assetsVerified": ["tasks", "market", "focus"], "report": str(output / "dark-recheck.json")}, ensure_ascii=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iteration", default="iteration-1")
    parser.add_argument("--dark-only", action="store_true", help="Only repeat dark screenshots and the latest three service artwork checks")
    args = parser.parse_args()
    assert re.fullmatch(r"[A-Za-z0-9_-]+", args.iteration)
    output = ROOT / ".map-qa-output" / "home-brand" / args.iteration
    output.mkdir(parents=True, exist_ok=True)
    if args.dark_only:
        dark_recheck(output)
        return
    report = {"base": BASE, "syntheticOnly": True, "iteration": args.iteration,
              "cases": [], "interactions": [], "favoriteLayouts": [], "blockedExternalRequests": []}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for width in (320, 390, 430):
            context = browser.new_context(viewport={"width": width, "height": 1240},
                                          device_scale_factor=1, reduced_motion="reduce")
            def local_only(route):
                url = route.request.url
                parsed = urlparse(url)
                if parsed.scheme in ("data", "blob") or (parsed.hostname == "127.0.0.1" and parsed.port == 43127):
                    route.continue_()
                else:
                    report["blockedExternalRequests"].append(url)
                    route.abort()
            context.route("**/*", local_only)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(BASE, wait_until="networkidle")
            expect(page.get_by_text("真实组件 / 本地样例，不是在线验收", exact=True)).to_be_visible()
            # The historical preview caps its shell at 390px. Override only the QA
            # wrapper to exercise the real homepage at each requested width.
            page.add_style_tag(content=f".ui-review-shell {{ width: min({width}px, 100%); }}")
            phone = page.locator("[data-home-preview-phone]")
            main_region = page.locator("[data-home-preview-main]")
            for scenario in SCENARIOS:
                select_scenario(page, scenario)
                if scenario == "slow":
                    expect(main_region.get_by_text("正在同步待办…", exact=True)).to_be_visible(timeout=2000)
                    screenshot(page, output / f"{width}-slow-loading.png")
                    expect(main_region.get_by_text("本地样例 · 整理英语课堂笔记", exact=True)).to_be_visible(timeout=7000)
                else:
                    page.wait_for_timeout(650)
                expect(main_region.get_by_role("heading", name="今日安排", exact=True)).to_be_visible()
                if scenario == "guest":
                    expect(main_region.get_by_text("登录后查看作业与计划 ›", exact=True)).to_be_visible()
                elif scenario == "empty":
                    expect(main_region.get_by_text("暂无待办，去添加一个 ›", exact=True)).to_be_visible()
                    expect(main_region.get_by_text("暂时没有新任务或闲置", exact=True)).to_be_visible()
                elif scenario == "error":
                    expect(main_region.get_by_text("待办暂时无法同步", exact=True)).to_be_visible()
                    expect(main_region.get_by_role("button", name="重试", exact=True)).to_be_visible()
                    expect(main_region.get_by_text("互助信息暂时无法同步", exact=True)).to_be_visible()
                elif scenario == "signed":
                    expect(main_region.get_by_text("本地样例 · 整理英语课堂笔记", exact=True)).to_be_visible()
                sizes = assert_width(page)
                touch = assert_touch_height(phone)
                broken_images = main_region.locator("img").evaluate_all("els => els.filter(e => e.complete && e.naturalWidth === 0).map(e => e.currentSrc || e.src)")
                assert not broken_images, broken_images
                expect(phone.get_by_role("navigation", name="主导航", exact=True)).to_be_visible()
                path = output / f"{width}-{scenario}.png"
                screenshot(page, path)
                report["cases"].append({"width": width, "scenario": scenario, "sizes": sizes, "touch": touch, "screenshot": str(path)})
                if width in (390, 430) and scenario == "signed":
                    main_region.evaluate("el => el.scrollTop = el.scrollHeight")
                    screenshot(page, output / f"{width}-signed-lower.png")
                    main_region.evaluate("el => el.scrollTop = 0")

            if width == 390:
                select_scenario(page, "signed")
                page.wait_for_timeout(500)
                main_region.get_by_role("button", name=re.compile("当前校区")).click()
                dialog = page.get_by_role("dialog", name="选择当前校区", exact=True)
                expect(dialog).to_be_visible()
                dialog.get_by_role("button", name=re.compile("苍梧校区")).click()
                expect(dialog).to_be_hidden()
                expect(main_region.get_by_role("button", name=re.compile("当前校区：苍梧校区"))).to_be_visible()
                report["interactions"].append("校区选择与本地回显")

                main_region.get_by_role("button", name="调整", exact=True).click()
                dialog = page.get_by_role("dialog", name="调整常用功能", exact=True)
                expect(dialog).to_be_visible()
                picker = dialog.locator('[aria-label="选择常用功能"]')
                picker.get_by_role("button", name="成绩", exact=True).click()
                dialog.get_by_role("button", name="保存调整", exact=True).click()
                expect(dialog).to_be_hidden()
                expect(main_region.get_by_role("navigation", name="常用功能").get_by_role("link", name="成绩", exact=True)).to_be_visible()
                report["interactions"].append("常用功能增加与保存")

                main_region.get_by_role("link", name=re.compile("^消息，")).click()
                expect(page).to_have_url(re.compile(r"#/messages$"))
                page.goto(BASE, wait_until="networkidle")
                report["interactions"].append("消息入口真实路由")
                page.locator('[aria-label="主导航"]').get_by_role("button", name="发布", exact=True).click()
                dialog = page.get_by_role("dialog", name="选择发布内容", exact=True)
                expect(dialog).to_be_visible()
                expect(dialog.get_by_role("button", name=re.compile("朋友圈"))).to_be_visible()
                screenshot(page, output / "390-publish-panel.png")
                dialog.get_by_role("button", name="收起发布面板", exact=True).click()
                expect(dialog).to_be_hidden()
                report["interactions"].append("底部发布打开与关闭")
                page.locator('[aria-label="主导航"]').get_by_role("link", name="服务", exact=True).click()
                expect(page).to_have_url(re.compile(r"#/services$"))
                report["interactions"].append("底部服务保留路由（隔离预览显示目标占位）")

            # Real local preference actions exercise 4/5/6 selected services.
            page.goto(BASE, wait_until="networkidle")
            page.add_style_tag(content=f".ui-review-shell {{ width: min({width}px, 100%); }}")
            select_scenario(page, "signed")
            page.wait_for_timeout(500)
            for count, extra in ((4, "成绩"), (5, "跑腿"), (6, "二手")):
                main_region.get_by_role("button", name="调整", exact=True).click()
                dialog = page.get_by_role("dialog", name="调整常用功能", exact=True)
                picker = dialog.locator('[aria-label="选择常用功能"]')
                option = picker.get_by_role("button", name=extra, exact=True)
                if option.get_attribute("aria-pressed") != "true":
                    option.click()
                dialog.get_by_role("button", name="保存调整", exact=True).click()
                expect(dialog).to_be_hidden()
                favorites = main_region.get_by_role("navigation", name="常用功能")
                expect(favorites.get_by_role("link")).to_have_count(count)
                favorites.scroll_into_view_if_needed()
                sizes = assert_width(page)
                touch = assert_touch_height(phone)
                screenshot(page, output / f"{width}-favorites-{count}.png")
                report["favoriteLayouts"].append({"width": width, "count": count, "sizes": sizes, "touch": touch})
            if width in (390, 430):
                main_region.evaluate("el => el.scrollTop = 0")
                choose_theme(page, main_region, "深色")
                screenshot(page, output / f"{width}-dark.png")
                main_region.evaluate("el => el.scrollTop = el.scrollHeight")
                screenshot(page, output / f"{width}-dark-lower.png")
                assert_width(page)
                assert_touch_height(phone)

            assert not errors, errors
            context.close()
        browser.close()
    report["passed"] = True
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"passed": True, "cases": len(report["cases"]), "favoriteLayouts": len(report["favoriteLayouts"]), "interactions": len(report["interactions"]),
                      "externalBlocked": len(report["blockedExternalRequests"]), "report": str(output / "report.json")}, ensure_ascii=True))


if __name__ == "__main__":
    main()
