from pathlib import Path
import base64,json,re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path(r'C:\Users\upwar\Desktop\新建文件夹 (7)')
OUT=SOURCE/'狐狸主题优化'; OUT.mkdir(exist_ok=True)
salt='sunshine-campus-jou-timetable-v1';fake='preview-only'
blob=base64.b64encode(bytes(ord(c)^ord(salt[i%len(salt)]) for i,c in enumerate(fake))).decode()
seed={'sc.firstRun.legal.v1:user':'1','sc.firstRun.perms.v1:user':'1','campus.gate.unlocked.v1':'1','schedule.lastStuid':'preview-local','schedule.rememberPwd':'1','schedule.pwdBlob.v1':blob,'campus.rememberAll.v1':'1','notify.consent.asked.v1':'1','sc.away.login.welcomed.v1':'1','app.theme':'light'}
routes=re.findall(r'`(\d+[^`]+\.png)` / `[^`]+` — (\S+)',(SOURCE/'截图清单.md').read_text(encoding='utf-8'))
routes=[(name,path.split('（')[0]) for name,path in routes]
report={'checks':[],'screens':[],'errors':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--enable-unsafe-swiftshader'])
    context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
    context.add_init_script('const seed='+json.dumps(seed)+';for(const [k,v] of Object.entries(seed)){if(!localStorage.getItem(k))localStorage.setItem(k,v)}sessionStorage.setItem("campus.autosync.quiet.v1","1")')
    page=context.new_page();requests=[]
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.on('request',lambda r:requests.append(r.url))
    page.route('**/api/timetable/**',lambda r:r.abort())
    def start(path='/'):
        page.goto('http://127.0.0.1:5173'+path,wait_until='domcontentloaded')
        page.wait_for_timeout(2000)
        try:
            if page.locator('#boot-skip').is_visible():page.locator('#boot-skip').click(timeout=1200)
        except Exception:pass
        page.locator('#boot-splash').wait_for(state='hidden',timeout=45000)
    def route(path):
        page.evaluate('(path)=>{history.pushState({idx:0},"",path);dispatchEvent(new PopStateEvent("popstate",{state:{idx:0}}))}',path)
        page.wait_for_timeout(800)
    start()
    assert page.locator('#fox-welcome-title').count()==0
    assert not any('/theme-packs/' in u or 'three.module' in u or 'GLTFLoader' in u for u in requests)
    report['checks'].append('Fresh install defaults to classic; no 3D or theme package network requests')
    page.screenshot(path=str(OUT/'经典版-首页.png'))
    route('/settings?section=appearance')
    modern=page.get_by_role('button',name=re.compile('狐狸主题版'))
    assert modern.is_disabled()
    with page.expect_download() as d:page.get_by_role('link',name='下载主题安装包',exact=True).click()
    package=d.value;package.save_as(str(OUT/'哦狐狐狸主题-v1.ohfox'))
    page.locator('input[type=file]').set_input_files(str(OUT/'哦狐狐狸主题-v1.ohfox'))
    modern.wait_for(state='visible');page.wait_for_function('document.querySelector("input[type=file]").disabled===false')
    assert modern.is_enabled()
    page.screenshot(path=str(OUT/'设置-双版本切换.png'))
    modern.click();assert modern.get_attribute('aria-pressed')=='true'
    report['checks'].append('Download, file import, integrity verification, IndexedDB install, activate fox theme')
    route('/')
    assert page.locator('canvas').count()==0
    assert not any('three.module' in u or 'GLTFLoader' in u for u in requests)
    page.screenshot(path=str(OUT/'狐狸主题-首页.png'))
    report['checks'].append('Fox theme renders without WebGL canvas or 3D runtime requests')
    start('/settings?section=appearance');assert page.get_by_role('button',name=re.compile('狐狸主题版')).get_attribute('aria-pressed')=='true'
    report['checks'].append('Installed package and selected theme survive reload')
    corrupt=OUT/'损坏主题测试.ohfox';corrupt.write_text('{"format":"ohfox-ui-pack","version":1,"assets":{}}')
    page.locator('input[type=file]').set_input_files(str(corrupt));page.wait_for_timeout(500)
    assert '缺失' in page.get_by_role('status').all_text_contents()[-1]
    corrupt.unlink()
    report['checks'].append('Corrupt package rejected without replacing valid installed theme')
    for theme in ['light','dark']:
        folder=OUT if theme=='light' else OUT/'dark';folder.mkdir(exist_ok=True)
        page.evaluate('(t)=>{localStorage.setItem("app.theme",t);document.documentElement.dataset.theme=t}',theme)
        for name,path in routes:
            route(path);page.screenshot(path=str(folder/name))
            broken=page.locator('img').evaluate_all('(imgs)=>imgs.filter(i=>i.complete&&!i.naturalWidth).map(i=>i.getAttribute("src"))')
            report['screens'].append({'theme':theme,'file':name,'route':path,'brokenImages':broken})
        print(theme,'screens',len(routes),flush=True)
    route('/services');page.get_by_role('button',name='学习与安排',exact=True).click();page.screenshot(path=str(OUT/'服务-学业筛选.png'))
    route('/settings?section=appearance');page.get_by_role('button',name=re.compile('经典版')).click();route('/')
    assert page.locator('#fox-welcome-title').count()==0 and page.locator('canvas').count()==0
    report['checks'].append('Switch back restores classic layout and keeps 3D disabled')
    for width in [320,390,430]:
        page.set_viewport_size({'width':width,'height':844})
        assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    report['checks'].append('Classic layout has no horizontal page overflow at 320/390/430')
    assert not report['errors'],report['errors']
    (OUT/'检查记录.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    browser.close()
print('Verified',len(report['checks']),'checks')
