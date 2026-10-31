import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ReminderPopup } from '../src/components/ReminderPopup'
import { ReminderDisplaySettings } from '../src/components/ReminderDisplaySettings'
import { DialogLayer } from '../src/components/ui/DialogLayer'
import type { ReminderCard, ReminderPopupStyle } from '../src/lib/reminder-popup'
import '../src/index.css'
import './reminder-preview.css'
const examples: ReminderCard[] = [
{id:'class',kind:'class-soon',title:'课前提醒 · 验证样例',name:'高等数学',detail:'14:00–15:35 · 教学楼 B204',hint:'还有 15 分钟开始，准备好课本与笔记。',route:'/schedule',actionLabel:'查看课表'},
{id:'exam',kind:'exam',title:'考试提醒 · 验证样例',name:'大学英语期末考试',detail:'明天 09:00 · 教学楼 A301 · 座位 12',hint:'检查证件与文具，预留到场时间。',route:'/study?tab=exams',actionLabel:'考试安排'},
{id:'todo',kind:'todo',title:'待办提醒 · 验证样例',name:'提交课程作业和小组汇报材料',detail:'今天 18:00 截止',hint:'查看任务详情，确认文件已成功提交。',route:'/todo',actionLabel:'查看待办'}
]
function Preview() {
 const [variant,setVariant]=useState<ReminderPopupStyle>('banner')
 const [queue,setQueue]=useState<ReminderCard[]>([])
 const [list,setList]=useState(false)
 return <main data-app-body><header><p>实际组件 · 浏览器验证</p><h1>提醒，清楚且及时。</h1><span>下面是标注的样例；未发送系统通知，也没有请求权限。</span></header>
 <section className="verification-controls"><h2>到点样式</h2><div>{(['banner','sheet','dialog'] as const).map(value=><button key={value} aria-pressed={variant===value} onClick={()=>setVariant(value)}>{value==='banner'?'顶部横幅':value==='sheet'?'底部卡片':'居中弹窗'}</button>)}</div><button onClick={()=>setQueue(examples)}>同时到点：展示 3 条样例</button></section>
 <ReminderDisplaySettings/>
 {queue[0]&&!list?<ReminderPopup key={queue[0].id+variant} item={queue[0]} variant={variant} remaining={queue.length-1} onDismiss={()=>setQueue(old=>old.slice(1))} onQueue={()=>setList(true)}/>:null}
 {list?<DialogLayer title="待处理提醒" onClose={()=>setList(false)}><h2>待处理提醒</h2>{queue.map(row=><p key={row.id}>{row.name}</p>)}<button onClick={()=>setList(false)}>返回当前提醒</button></DialogLayer>:null}
 </main>
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Preview/></BrowserRouter>)
