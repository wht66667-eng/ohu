from playwright.sync_api import sync_playwright

URL = "https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/lyg-games/manifest.json"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page()
    page.goto("http://127.0.0.1:4173/", wait_until="domcontentloaded")
    r = page.evaluate(
        """async (url) => {
          try {
            const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
            const text = await res.text();
            return { ok: res.ok, status: res.status, text: text.slice(0, 160) };
          } catch (e) {
            return { err: String(e), name: e && e.name, msg: e && e.message };
          }
        }""",
        URL,
    )
    print(r)
    b.close()
