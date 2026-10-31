from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
state={'__file__':str(ROOT/'tools/ui-themes/verify_themes.py')};exec((ROOT/'tools/ui-themes/verify_themes.py').read_text(encoding='utf-8-sig').split('with sync_playwright() as p:')[0],state,state)
seed=state['seed'];source=state['SOURCE'];routes=state['routes'];out=ROOT/'design-system/ui-v3-v4/review'
report={'checks':[],'errors':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2)
 context.add_init_script('const seed='+json.dumps(seed)+';for(const[k,v]of Object.entries(seed)){if(!localStorage.getItem(k))localStorage.setItem(k,v)}sessionStorage.setItem("campus.autosync.quiet.v1","1")')
 page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));page.route('**/api/timetable/**',lambda r:r.abort())
 page.goto('http://127.0.0.1:5173/settings?section=appearance');page.wait_for_timeout(2000)
 try:
  if page.locator('#boot-skip').is_visible():page.locator('#boot-skip').click(timeout=1200)
 except Exception:pass
 page.locator('#boot-splash').wait_for(state='hidden',timeout=45000)
 def route(path):
  page.evaluate('(p)=>{history.pushState({idx:0},"",p);dispatchEvent(new PopStateEvent("popstate",{state:{idx:0}}))}',path);page.wait_for_timeout(550)
 for id,title,foldername in [('cute','第 3 版','第三版-软萌几何'),('minimal','第 4 版','第四版-极简大气')]:
  route('/settings?section=appearance');choice=page.get_by_role('button',name=re.compile(title));box=choice.locator('..')
  assert choice.is_disabled();box.get_by_role('button',name='下载安装',exact=True).click()
  page.wait_for_function('document.querySelector("input[type=file]").disabled===false');assert choice.is_enabled()
  assert page.evaluate('document.documentElement.dataset.uiVariant')==('classic' if id=='cute' else 'cute')
  assert box.get_by_role('button',name='已安装',exact=True).is_disabled();choice.click();page.wait_for_timeout(400)
  assert choice.get_attribute('aria-pressed')=='true'
  for theme in ['light','dark']:
   page.evaluate('(t)=>{localStorage.setItem("app.theme",t);document.documentElement.dataset.theme=t}',theme)
   for name,path in routes:
    if path.startswith(('/settings','/study')) or path in ['/profile','/todo','/schedule','/wallet']:
     route(path)
     if path.startswith('/study') or path in ['/todo','/schedule','/wallet']:assert page.get_by_role('button',name='收起小狐狸',exact=True).count()==0
     dest=source/foldername if theme=='light' else source/foldername/'dark';page.screenshot(path=str(dest/name))
     assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
   route('/');page.evaluate('document.documentElement.style.setProperty("--safe-top","24px");document.documentElement.style.setProperty("--safe-bottom","34px")');page.wait_for_timeout(300)
   page.screenshot(path=str(source/foldername/('安全区-'+theme+'.png')))
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
   page.evaluate('document.documentElement.style.removeProperty("--safe-top");document.documentElement.style.removeProperty("--safe-bottom")')
  report['checks'].append(id+': real download-and-install button, trusted package gating, no automatic theme switch; updated settings/profile dual themes; safe areas 24/34')
 assert not report['errors'],report['errors']
 (out/'补充检查.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 browser.close()
print('PASS supplementary install and phone UI checks')
