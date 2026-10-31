from pathlib import Path
import base64,json,re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path(r'C:\Users\upwar\Desktop\新建文件夹 (7)')
OUT=ROOT/'design-system/ui-v3-v4/review';OUT.mkdir(parents=True,exist_ok=True)
salt='sunshine-campus-jou-timetable-v1';fake='preview-only'
blob=base64.b64encode(bytes(ord(c)^ord(salt[i%len(salt)]) for i,c in enumerate(fake))).decode()
seed={'sc.firstRun.legal.v1:user':'1','sc.firstRun.perms.v1:user':'1','campus.gate.unlocked.v1':'1','schedule.lastStuid':'preview-local','schedule.rememberPwd':'1','schedule.pwdBlob.v1':blob,'campus.rememberAll.v1':'1','notify.consent.asked.v1':'1','sc.away.login.welcomed.v1':'1','app.theme':'light','sc.foxDock.v1':'0'}
routes=re.findall(r'`(\d+[^`]+\.png)` / `[^`]+` — (\S+)',(SOURCE/'截图清单.md').read_text(encoding='utf-8'))
routes=[(name,path.split('（')[0]) for name,path in routes]+[('45-目标墙.png','/study/goals'),('46-外观设置.png','/settings?section=appearance')]
report={'checks':[],'screens':[],'errors':[],'brokenImages':[],'overflow':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
 context.add_init_script('const seed='+json.dumps(seed)+';for(const [k,v] of Object.entries(seed)){if(!localStorage.getItem(k))localStorage.setItem(k,v)}sessionStorage.setItem("campus.autosync.quiet.v1","1")')
 page=context.new_page();requests=[]
 page.on('pageerror',lambda e:report['errors'].append(str(e)))
 page.on('request',lambda r:requests.append(r.url))
 page.route('**/api/timetable/**',lambda r:r.abort())
 def start(path='/'):
  page.goto('http://127.0.0.1:5173'+path,wait_until='domcontentloaded');page.wait_for_timeout(1500)
  try:
   if page.locator('#boot-skip').is_visible():page.locator('#boot-skip').click(timeout=1200)
  except Exception:pass
  page.locator('#boot-splash').wait_for(state='hidden',timeout=45000)
 def route(path):
  page.evaluate('(path)=>{history.pushState({idx:0},"",path);dispatchEvent(new PopStateEvent("popstate",{state:{idx:0}}))}',path);page.wait_for_timeout(500)
 def select(id,title):
  route('/settings?section=appearance');page.get_by_role('button',name=re.compile(title)).click()
  page.wait_for_function('(v)=>document.documentElement.dataset.uiVariant===v',arg=id)
 start();assert page.evaluate('document.documentElement.dataset.uiVariant')=='classic'
 assert not any('/theme-packs/' in u or 'three.module' in u or 'GLTFLoader' in u for u in requests)
 page.screenshot(path=str(OUT/'经典版-首页.png'))
 report['checks'].append('Fresh install remains classic; optional packages are not automatically fetched')
 route('/settings?section=appearance')
 for title in ['第 2 版','第 3 版','第 4 版']:assert page.get_by_role('button',name=re.compile(title)).is_disabled()
 for id,title,file in [('fox','第 2 版','ohfox-theme-v1.ohfox'),('cute','第 3 版','ohfox-cute-v3.ohfox'),('minimal','第 4 版','ohfox-minimal-v4.ohfox')]:
  with page.expect_download() as d:page.get_by_role('link',name=re.compile('下载'+title)).click()
  target=OUT/file;d.value.save_as(str(target))
  page.locator('input[type=file]').set_input_files(str(target));page.wait_for_function('document.querySelector("input[type=file]").disabled===false')
  assert page.get_by_role('button',name=re.compile(title)).is_enabled()
  assert page.evaluate('document.documentElement.dataset.uiVariant')=='classic'
 report['checks'].append('All three optional packages download, verify, install independently; installing does not switch current UI')
 select('fox','第 2 版');route('/');assert page.locator('#fox-welcome-title').count()==1
 page.screenshot(path=str(OUT/'第2版-首页.png'))
 report['checks'].append('Existing v2 package and fox home still work')
 for id,title,foldername,radius in [('cute','第 3 版','第三版-软萌几何','20px'),('minimal','第 4 版','第四版-极简大气','16px')]:
  select(id,title);start('/settings?section=appearance');assert page.get_by_role('button',name=re.compile(title)).get_attribute('aria-pressed')=='true'
  assert page.evaluate('getComputedStyle(document.documentElement).getPropertyValue("--radius").trim()')==radius
  folder=SOURCE/foldername;folder.mkdir(exist_ok=True)
  for theme in ['light','dark']:
   dest=folder if theme=='light' else folder/'dark';dest.mkdir(exist_ok=True)
   page.evaluate('(t)=>{localStorage.setItem("app.theme",t);document.documentElement.dataset.theme=t}',theme)
   for name,path in routes:
    route(path);page.screenshot(path=str(dest/name))
    broken=page.locator('img').evaluate_all('(imgs)=>imgs.filter(i=>i.complete&&!i.naturalWidth).map(i=>i.getAttribute("src"))')
    if broken:report['brokenImages'].append({'variant':id,'theme':theme,'route':path,'images':broken})
    if page.evaluate('document.documentElement.scrollWidth>innerWidth'):report['overflow'].append({'variant':id,'theme':theme,'route':path})
    report['screens'].append({'variant':id,'theme':theme,'file':str(dest/name),'route':path})
   print(id,theme,len(routes),'phone screens',flush=True)
  route('/services');page.get_by_role('button',name='学习与安排',exact=True).click()
  assert page.get_by_role('button',name='学习与安排',exact=True).get_attribute('aria-pressed')=='true'
  assert page.get_by_role('link',name=re.compile('课表')).count()>0
  page.locator('input[type=search]').fill('不应匹配的测试关键词');page.wait_for_timeout(500)
  assert page.get_by_role('button',name='查看全部服务').is_visible()
  page.get_by_role('button',name='查看全部服务').click()
  for width in [320,390,430]:
   page.set_viewport_size({'width':width,'height':844})
   for path in ['/','/services','/todo','/study','/study/goals','/study/focus','/settings?section=appearance']:
    route(path);assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),(id,width,path)
  page.set_viewport_size({'width':390,'height':844})
  page.emulate_media(reduced_motion='reduce');route('/study/focus');page.screenshot(path=str(folder/'弱动效-专注.png'))
  assert not page.evaluate('document.getAnimations().some(a=>a.effect?.getTiming().iterations===Infinity && a.playState==="running")')
  page.emulate_media(reduced_motion='no-preference')
  report['checks'].append(id+': persistent selection; light/dark phone routes; filters/search/empty reset; 320/390/430; reduced motion no infinite loops')
 route('/settings?section=appearance')
 corrupt=OUT/'corrupt.ohfox';data=json.loads((OUT/'ohfox-cute-v3.ohfox').read_text());data['assets']['avatar.webp']=base64.b64encode(b'broken').decode();corrupt.write_text(json.dumps(data))
 page.locator('input[type=file]').set_input_files(str(corrupt));page.wait_for_function('document.querySelector("input[type=file]").disabled===false')
 assert '校验失败' in page.locator('section[aria-label="界面版本"] [role=status]').inner_text()
 assert page.get_by_role('button',name=re.compile('第 3 版')).is_enabled();corrupt.unlink()
 select('classic','经典版');route('/');assert page.locator('#cute-welcome-title,#fox-welcome-title').count()==0
 report['checks'].append('Tampered pack rejected without replacing working installs; classic restored successfully')
 assert not any('three.module' in u or 'GLTFLoader' in u for u in requests)
 report['checks'].append('No live 3D model runtime requested')
 (OUT/'检查记录.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 assert not report['errors'],report['errors'];assert not report['brokenImages'],report['brokenImages'];assert not report['overflow'],report['overflow']
 browser.close()
print('PASS',len(report['checks']),'checks',len(report['screens']),'screens',flush=True)

