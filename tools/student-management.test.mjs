import test from 'node:test'
import assert from 'node:assert/strict'
import { studentManagementActions as actions, contentManagementSelection as selection, studentManagementReturn as back } from '../src/lib/student-management.ts'

test('普通用户与非内容页面不获得管理入口',()=>{for(const path of ['/profile','/plaza','/plugins','/campus-map'])assert.deepEqual(actions(path,false),[]);for(const path of ['/chat','/moments','/admin/content','//evil.test','https://evil.test'])assert.deepEqual(actions(path,true),[])})
test('管理员进入当前内容对应标签，并维持学生端视图',()=>{for(const [path,tab] of [['/plaza','plaza'],['/campus-map','campus'],['/task/9','posts'],['/item/4','goods']]){const link=new URL(actions(path,true)[0].href,'https://local.invalid');assert.equal(link.searchParams.get('tab'),tab);assert.equal(link.searchParams.get('view'),'student');assert.equal(back(link.searchParams.get('from')),`${path}?view=student`)}})
test('插件申请落到现有反馈来源并筛选插件，其他来源不可注入',()=>{const link=new URL(actions('/plugins',true)[0].href,'https://local.invalid');assert.deepEqual(selection(link.searchParams),{tab:'comments',feedback:true,keyword:'插件'});assert.deepEqual(selection(new URLSearchParams('tab=users&source=profiles&topic=plugin')),{tab:'goods',feedback:false,keyword:''})})
test('返回地址拒绝外部地址、查询拼接、任意后台与路径穿越',()=>{for(const value of [null,'//evil.test','https://evil.test','/admin/members','/profile?evil=1','/profile/../admin','/task/0','/item/-1','profile'])assert.equal(back(value),null)})

// 使用真实管理页面，只替换登录、数据读取和JSX运行环境；不会连接云端。
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function renderContent(search, admin = true) {
 const source=fs.readFileSync(new URL('../src/pages/AdminContentPage.tsx',import.meta.url),'utf8')
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
 const jsx=(type,props)=>({type,props:props||{}}),css={__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})}
 const moderation={GOODS_SOURCE_ORDER:['secondhand_items','ebike_items'],COMMENT_SOURCE_ORDER:['secondhand_item_comments','feedbacks','secondhand_evaluations'],POST_SOURCE_ORDER:['tasks','help_items'],GOODS_SOURCE_TEXT:{},COMMENT_SOURCE_TEXT:{},POST_SOURCE_TEXT:{},POST_SOURCE_ICON:{}}
 const imports={react:{useState:v=>[typeof v==='function'?v():v,()=>{}],useRef:v=>({current:v}),useEffect(){},useMemo:fn=>fn()},'react/jsx-runtime':{jsx,jsxs:jsx},'react-router-dom':{Link:'link',useNavigate:()=>()=>{},useSearchParams:()=>[new URLSearchParams(search)]},'../lib/student-management':{contentManagementSelection:selection,studentManagementReturn:back},'../lib/auth':{useAuth:()=>({isSigned:true,user:{uid:'synthetic-only'},profile:{isAdmin:admin}})},'../context/ToastContext':{useToast:()=>()=>{}},'../lib/hooks':{usePollingRows:()=>({rows:[],loading:false,error:null,hasMore:false})},'../lib/moderation':moderation,'../components/PageHeader':{PageHeader:'header'},'../components/ConfirmSheet':{ConfirmSheet:'confirm'},'./AdminPlazaPane':{AdminPlazaPane:'plaza-pane'},'./AdminCampusMapPane':{AdminCampusMapPane:'campus-pane'},'../components/ui/StateViews':{DeniedState:'denied',EmptyState:'empty',ErrorState:'error',LoadingState:'loading'},'./work.module.css':css,'./AdminContentPage.module.css':css}
 const module={exports:{}};vm.runInNewContext(compiled,{module,exports:module.exports,require:name=>{assert.ok(name in imports,name);return imports[name]}});return module.exports.AdminContentPage()
}
function nodes(tree){return Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[]}
test('真实内容管理页按学生入口选择反馈来源、插件筛选和安全返回链接',()=>{const all=nodes(renderContent('view=student&from=%2Fplugins&tab=comments&source=feedbacks&topic=plugin'));assert.ok(all.some(n=>n.type==='link'&&n.props.to==='/plugins?view=student'));assert.ok(all.some(n=>n.type==='input'&&n.props.value==='插件'));assert.equal(all.some(n=>n.type==='denied'),false)})
test('真实管理页默认拒绝普通用户，查询参数不能授予权限',()=>{const all=nodes(renderContent('view=student&tab=campus&admin=true',false));assert.ok(all.some(n=>n.type==='denied'));assert.equal(all.some(n=>n.type==='campus-pane'),false)})
test('真实管理页地图入口使用原有地点审核组件',()=>{assert.ok(nodes(renderContent('view=student&from=%2Fcampus-map&tab=campus')).some(n=>n.type==='campus-pane'))})
