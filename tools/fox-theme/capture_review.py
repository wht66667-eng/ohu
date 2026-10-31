"""Capture real unsigned UI in a fresh isolated browser, with no business writes."""
from pathlib import Path
import re,json,base64
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path(r'C:\Users\upwar\Desktop\新建文件夹 (7)')
OUT=SOURCE/'狐狸主题优化'
OUT.mkdir(exist_ok=True)
routes=re.findall(r'`(\d+[^`]+\.png)` / `[^`]+` — (\S+)',(SOURCE/'截图清单.md').read_text(encoding='utf-8'))
salt='sunshine-campus-jou-timetable-v1'; fake='preview-only'
blob=base64.b64encode(bytes(ord(c)^ord(salt[i%len(salt)]) for i,c in enumerate(fake))).decode()
seed={'sc.firstRun.legal.v1:user':'1','sc.firstRun.perms.v1:user':'1','campus.gate.unlocked.v1':'1','schedule.lastStuid':'preview-local','schedule.rememberPwd':'1','schedule.pwdBlob.v1':blob,'campus.rememberAll.v1':'1'}
seed.update({'notify.consent.asked.v1':'1','sc.away.login.welcomed.v1':'1'})
def settle(page):
    page.wait_for_timeout(700)
    if page.locator('#boot-skip').is_visible(): page.locator('#boot-skip').click()
    page.locator('#boot-splash').wait_for(state='hidden',timeout=25000)
report=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
    # Keep test credentials local and prevent automatic credential requests.
    context.add_init_script('const seed='+json.dumps(seed)+'; for(const [k,v] of Object.entries(seed))localStorage.setItem(k,v); sessionStorage.setItem("campus.autosync.quiet.v1","1");')
    page=context.new_page()
    errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/api/timetable/**',lambda route:route.abort())
    for theme in ['light','dark']:
        folder=OUT if theme=='light' else OUT/'dark'; folder.mkdir(exist_ok=True)
        for name,path in routes:
            page.goto('http://127.0.0.1:5173'+path,wait_until='domcontentloaded')
            page.evaluate('(t)=>{localStorage.setItem("app.theme",t); document.documentElement.dataset.theme=t}',theme)
            page.wait_for_timeout(750)
            try:
                settle(page)
            except Exception:
                page.screenshot(path=str(OUT/'启动检查.png'))
                print(json.dumps({'errors':errors,'body':page.locator('body').inner_text()[-2000:]},ensure_ascii=True),flush=True)
                raise
            page.screenshot(path=str(folder/name))
            broken=page.locator('img').evaluate_all('(imgs)=>imgs.filter(i=>i.complete&&!i.naturalWidth).map(i=>i.getAttribute("src"))')
            report.append({'theme':theme,'file':name,'route':path,'brokenImages':broken,'heading':page.locator('h1').all_text_contents()})
        print(theme,'captured',len(routes),flush=True)
    page.goto('http://127.0.0.1:5173/',wait_until='domcontentloaded'); settle(page)
    page.get_by_role('button',name='快捷设置',exact=True).click()
    page.get_by_role('button',name='浅色',exact=True).click()
    page.screenshot(path=str(OUT/'首页-快捷设置.png'))
    page.get_by_role('button',name='关闭快捷设置',exact=True).click()
    page.get_by_role('button',name='调整',exact=True).click()
    page.screenshot(path=str(OUT/'首页-服务调整.png'))
    page.get_by_role('button',name='关闭常用服务调整',exact=True).click()
    page.get_by_role('button',name='发布',exact=True).click()
    page.screenshot(path=str(OUT/'首页-发布菜单.png'))
    # Verify narrow screens and reduced motion independently.
    page.goto('http://127.0.0.1:5173/services',wait_until='domcontentloaded'); settle(page)
    page.get_by_role('button',name='学习',exact=True).click()
    page.screenshot(path=str(OUT/'服务-学业筛选.png'))
    for width in [320,390,430]:
        page.set_viewport_size({'width':width,'height':844}); page.goto('http://127.0.0.1:5173/'); settle(page)
        overflow=page.evaluate('document.documentElement.scrollWidth>innerWidth')
        assert not overflow, f'Horizontal overflow at {width}'
    page.emulate_media(reduced_motion='reduce'); page.goto('http://127.0.0.1:5173/tasks'); page.wait_for_timeout(600)
    active=page.locator('[class*="tail"]').evaluate_all('(els)=>els.flatMap(e=>e.getAnimations()).filter(a=>a.playState==="running").length')
    assert active==0,'Reduced motion tail still animates'
    (OUT/'检查记录.json').write_text(json.dumps({'screens':report,'pageErrors':errors,'checks':['settings theme','service reorder sheet','publish sheet','service category filter','320/390/430 no page overflow','reduced motion tail stopped']},ensure_ascii=False,indent=2),encoding='utf-8')
    browser.close()
print('Review written to',OUT)
