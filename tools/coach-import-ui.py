import json
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:5199'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(BASE + '/') else route.abort())
    try:
        page.goto(BASE + '/study?tab=coach')
        page.wait_for_load_state('networkidle')
        page.get_by_role('button', name='跳过介绍', exact=True).wait_for(timeout=20000)
        page.get_by_role('button', name='跳过介绍', exact=True).click()
        page.get_by_role('checkbox').check()
        page.get_by_role('button', name='同意并继续', exact=True).click()
        page.get_by_role('button', name='暂不授权', exact=True).click()
        save = page.get_by_role('button', name='保存到本机待办', exact=True)
        try:
            save.wait_for(timeout=20000)
        except Exception:
            print(json.dumps({'body': page.locator('body').inner_text(), 'errors': errors}, ensure_ascii=True))
            raise
        save.click()
        panel = page.get_by_role('region', name='确认保存本机待办')
        expect(panel.get_by_role('button', name='确认保存 0 项')).to_be_disabled()
        expect(panel.get_by_role('checkbox').first).not_to_be_checked()
        panel.get_by_role('button', name='取消保存').click()
        assert page.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('ohu.todo.import')).length") == 0
        save.click()
        panel.get_by_role('checkbox').first.check()
        panel.get_by_role('button', name='确认保存 1 项').click()
        expect(page.get_by_text('已写入 1 · 已存在 0 · 待核对 0 · 未写入 0', exact=True)).to_be_visible()
        storage = page.evaluate("Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('ohu.todo.import')||k.startsWith('ohu.todo.local'))) ")
        local_key = next(k for k in storage if k.startswith('ohu.todo.local'))
        ledger_key = next(k for k in storage if k.startswith('ohu.todo.import'))
        rows = json.loads(storage[local_key])
        assert len(rows) == 1 and rows[0]['due_at'] is None
        assert rows[0]['importKey'] and rows[0]['id'] < 0
        page.reload()
        save.click()
        panel.get_by_role('checkbox').first.check()
        panel.get_by_role('button', name='确认保存 1 项').click()
        expect(page.get_by_text('已写入 0 · 已存在 1 · 待核对 0 · 未写入 0', exact=True)).to_be_visible()
        assert page.evaluate('(key)=>JSON.parse(localStorage.getItem(key)).length', local_key) == 1
        page.evaluate('(key)=>{const rows=JSON.parse(localStorage.getItem(key));rows[0].status="pending";localStorage.setItem(key,JSON.stringify(rows))}', ledger_key)
        page.get_by_role('button', name='查看待处理记录').click()
        expect(page.get_by_role('button', name='核对本机写入结果')).to_be_visible()
        page.get_by_role('button', name='核对本机写入结果').click()
        expect(page.get_by_role('button', name='核对本机写入结果')).to_have_count(0)
        assert page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))[0].status', ledger_key) == 'created'
        assert not errors, errors
        screenshot = Path(tempfile.gettempdir()) / 'm5-coach-local-import.png'
        page.screenshot(path=str(screenshot), full_page=True)
        print(json.dumps({'checks': ['default-unselected', 'cancel-no-write', 'local-save', 'no-midnight-reminder', 'reload-dedup', 'pending-key-reconcile', 'no-pageerror'], 'screenshot': str(screenshot)}, ensure_ascii=True))
    finally:
        browser.close()
