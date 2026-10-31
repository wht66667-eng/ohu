"""Functional checks in isolated browser storage; no cloud records are written."""
from pathlib import Path
import base64
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / 'design-system/ui-v3-v4/study-checks.json'
salt = 'sunshine-campus-jou-timetable-v1'
fake = 'preview-only'
blob = base64.b64encode(bytes(ord(c) ^ ord(salt[i % len(salt)]) for i, c in enumerate(fake))).decode()
seed = {'sc.firstRun.legal.v1:user': '1', 'sc.firstRun.perms.v1:user': '1', 'campus.gate.unlocked.v1': '1', 'schedule.lastStuid': 'preview-local', 'schedule.rememberPwd': '1', 'schedule.pwdBlob.v1': blob, 'campus.rememberAll.v1': '1', 'notify.consent.asked.v1': '1', 'sc.away.login.welcomed.v1': '1', 'app.theme': 'light'}
report = {'checks': [], 'errors': []}

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for variant, filename in [('cute', 'ohfox-cute-v3.ohfox'), ('minimal', 'ohfox-minimal-v4.ohfox')]:
        context = browser.new_context(viewport={'width': 390, 'height': 844})
        context.add_init_script('const seed=' + json.dumps(seed) + ';for(const [k,v] of Object.entries(seed)){if(!localStorage.getItem(k))localStorage.setItem(k,v)}sessionStorage.setItem("campus.autosync.quiet.v1","1")')
        page = context.new_page()
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.route('**/api/timetable/**', lambda route: route.abort())
        page.goto('http://127.0.0.1:5173/study/goals', wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        try:
            if page.locator('#boot-skip').is_visible():
                page.locator('#boot-skip').click(timeout=1200)
        except Exception:
            pass
        page.locator('#boot-splash').wait_for(state='hidden', timeout=45000)
        package = json.loads((ROOT / 'public/theme-packs' / filename).read_text(encoding='utf-8'))
        page.evaluate('''async ({pack, variant}) => {
          const mod = await import('/src/lib/ui-variant.ts');
          await mod.restoreUiVariant();
          await mod.installUiPack(new File([JSON.stringify(pack)], 'theme.ohfox'));
          mod.chooseUiVariant(variant);
        }''', {'pack': package, 'variant': variant})
        page.wait_for_function('(v)=>document.documentElement.dataset.uiVariant===v', arg=variant)
        page.get_by_role('heading', name='目标墙', exact=True).wait_for()
        page.get_by_role('button', name='新目标', exact=True).click()
        page.get_by_label('目标名称', exact=True).fill('本机测试目标')
        page.get_by_label('下一小步（选填）', exact=True).fill('这是隔离浏览器中的功能测试记录')
        page.get_by_role('button', name='保存目标', exact=True).click()
        page.get_by_role('heading', name='本机测试目标', exact=True).wait_for()
        assert page.evaluate('JSON.parse(localStorage.getItem("study.goals.local.v1:guest"))[0].title') == '本机测试目标'
        page.get_by_role('button', name='给自己鼓励：本机测试目标', exact=True).click()
        assert page.get_by_role('button', name='收起鼓励：本机测试目标', exact=True).get_attribute('aria-pressed') == 'true'
        page.get_by_role('button', name='编辑目标：本机测试目标', exact=True).click()
        page.get_by_label('目标名称', exact=True).fill('修改后的目标')
        page.get_by_role('button', name='保存目标', exact=True).click()
        page.get_by_role('heading', name='修改后的目标', exact=True).wait_for()
        page.get_by_role('button', name='完成目标：修改后的目标', exact=True).click()
        page.get_by_role('button', name='已完成', exact=True).click()
        page.get_by_role('heading', name='修改后的目标', exact=True).wait_for()
        assert page.evaluate('JSON.parse(localStorage.getItem("study.goals.local.v1:guest"))[0].done') is True
        page.get_by_role('button', name='重新打开目标：修改后的目标', exact=True).click()
        page.get_by_role('button', name='正在成长', exact=True).click()
        page.get_by_role('heading', name='修改后的目标', exact=True).wait_for()
        page.reload(wait_until='domcontentloaded')
        page.locator('#boot-splash').wait_for(state='hidden', timeout=45000)
        page.get_by_role('heading', name='修改后的目标', exact=True).wait_for()
        assert page.evaluate('document.documentElement.dataset.uiVariant') == variant
        page.get_by_role('button', name='删除目标：修改后的目标', exact=True).click()
        page.locator('dialog').get_by_role('button', name='取消', exact=True).click()
        page.get_by_role('heading', name='修改后的目标', exact=True).wait_for()
        page.get_by_role('button', name='删除目标：修改后的目标', exact=True).click()
        page.locator('dialog').get_by_role('button', name='删除', exact=True).click()
        assert page.evaluate('JSON.parse(localStorage.getItem("study.goals.local.v1:guest")).length') == 0
        report['checks'].append(f'{variant}: create, encourage, edit, complete, reopen, reload persistence, cancel deletion, confirm deletion')
        page.get_by_role('button', name='新目标', exact=True).click()
        page.get_by_role('button', name='保存目标', exact=True).click()
        assert page.get_by_role('alert').inner_text() == '先给目标起一个名字吧'
        page.get_by_label('目标名称', exact=True).fill('模拟保存失败')
        page.evaluate('''() => { window.goalStorageOriginal = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('study.goals.local.v1:')) throw new DOMException('Test storage failure', 'QuotaExceededError'); return window.goalStorageOriginal.call(this, key, value) } }''')
        page.get_by_role('button', name='保存目标', exact=True).click()
        assert page.get_by_role('alert').inner_text() == '本机保存失败，请检查存储空间后重试。'
        assert page.locator('dialog').is_visible()
        assert page.evaluate('JSON.parse(localStorage.getItem("study.goals.local.v1:guest")).length') == 0
        page.evaluate('() => { Storage.prototype.setItem = window.goalStorageOriginal }')
        page.locator('dialog').get_by_role('button', name='取消', exact=True).click()
        report['checks'].append(f'{variant}: empty title rejected; storage failure preserves form and creates no false saved record')
        for width in [320, 390, 430]:
            page.set_viewport_size({'width': width, 'height': 844})
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        report['checks'].append(f'{variant}: goal page has no document overflow at 320 / 390 / 430 px')
        page.set_viewport_size({'width': 390, 'height': 844})
        for route, heading in [('/todo', '我的待办'), ('/study/focus', '专注'), ('/study', '学业中心')]:
            page.evaluate('(path)=>{history.pushState({idx:0}, "", path); dispatchEvent(new PopStateEvent("popstate", {state:{idx:0}}))}', route)
            page.get_by_role('heading', name=heading, exact=True).wait_for()
            assert page.evaluate('document.documentElement.dataset.uiVariant') == variant
            assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
        page.get_by_role('link', name='目标墙').wait_for()
        page.get_by_role('tab', name='成绩', exact=True).click()
        page.get_by_role('heading', name='教务成绩', exact=True).wait_for()
        page.get_by_role('tab', name='考试', exact=True).click()
        page.get_by_role('heading', name='本学期考试安排', exact=True).wait_for()
        report['checks'].append(f'{variant}: phone Todo, Focus, Study routes load; grades / exams tabs retain existing data UI')
        context.close()
    browser.close()

assert not report['errors'], report['errors']
REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
