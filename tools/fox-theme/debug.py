from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(headless=True); page=b.new_page(); errors=[]; page.on('pageerror',lambda e: errors.append(str(e))); page.goto('http://127.0.0.1:5173/'); page.wait_for_timeout(7000); print(errors); print(page.locator('body').inner_text()[-3500:]); page.screenshot(path='design-system/fox-campus/debug.png'); b.close()
