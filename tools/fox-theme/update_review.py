from pathlib import Path
p=Path('tools/fox-theme/verify_theme.py'); s=p.read_text(encoding='utf-8')
s=s.replace('阿狐 3D 版','狐狸主题版').replace('哦狐3D主题-v1.ohfox','哦狐狐狸主题-v1.ohfox').replace('activate 3D theme','activate fox theme')
a=s.index('    stage=page.get_by_role('); b=s.index("    start('/settings?section=appearance')",a)
s=s[:a]+'''    assert page.locator('canvas').count()==0
    assert not any('three.module' in u or 'GLTFLoader' in u for u in requests)
    page.screenshot(path=str(OUT/'狐狸主题-首页.png'))
    report['checks'].append('Fox theme renders without WebGL canvas or 3D runtime requests')
'''+s[b:]
s=s.replace("page.locator('canvas').count()==0","page.locator('canvas').count()==0").replace('unmounts WebGL','keeps 3D disabled')
p.write_text(s,encoding='utf-8')
p=Path('src/components/HomeServiceIcon.tsx');s=p.read_text(encoding='utf-8').replace('fox3d','fox');p.write_text(s,encoding='utf-8')
