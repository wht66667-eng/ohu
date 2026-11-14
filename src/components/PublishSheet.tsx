import { HomeServiceIcon } from './HomeServiceIcon'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { MenuCloseIcon } from './ui/motion-ui'
import { DialogLayer } from './ui/DialogLayer'
import { revealItem, revealShortList } from '../lib/animations'
import { useUiMotion } from '../lib/motion-pref'
import { useAuth } from '../lib/auth'
import { QuickRecordSheet } from './QuickRecordSheet'
import styles from './PublishSheet.module.css'

type PublishOption = { title: string; desc: string; to: string; image?: string; width?: number; height?: number; quick?: boolean }

const OPTIONS: PublishOption[] = [
  { title: '记一笔', desc: '喝水、吃饭、消费或一句话', to: '', quick: true },
  { title: '拍照', desc: '拍下今天的校园日常', to: '/campus-life?section=journal&compose=camera' },
  { title: '发动态', desc: '选择好友或校园动态', to: '/campus-life?section=publish' },
  { title: '贴便签', desc: '找搭子、失物、求助和活动', to: '/campus-life?section=notes&compose=note' },
  { title: '写手账', desc: '留一张照片或一句话', to: '/campus-life?section=journal&compose=journal' },
  { title: '任务', desc: '发布跑腿需求', image: 'publish-option-2.webp', width: 85, height: 82, to: '/tasks?publish=1' },
  { title: '闲置', desc: '交换闲置好物', image: 'publish-option-3.webp', width: 85, height: 82, to: '/market?publish=1' },
]
export function PublishSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const reduce = useUiMotion()
  const auth = useAuth()
  const owner = auth.isSigned && auth.user?.uid ? 'user:' + auth.user.uid : 'guest'
  const [quick, setQuick] = useState(false)
  const destination = useRef<string | null>(null)
  const requestClose = (element: HTMLElement) => element.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
  return <>
    <DialogLayer title="和哦狐一起发布" className={styles.sheet} onClose={() => { onClose(); if (destination.current) navigate(destination.current) }}>
    <div className={styles.handle} aria-hidden="true" />
    <div className={styles.head}><div><span className={styles.eyebrow}>OHU · SHARE YOUR CAMPUS</span><h2>想发布什么？</h2><p>和哦狐一起，分享校园里的新鲜事。</p></div><button type="button" className={styles.close} aria-label="收起发布面板" onClick={(event) => requestClose(event.currentTarget)}><MenuCloseIcon open size={20} /></button></div>
    <motion.div className={styles.grid} variants={reduce ? undefined : revealShortList} initial={reduce ? false : 'hidden'} animate="show">
      {OPTIONS.map((option) => <motion.button type="button" key={option.title} className={styles.opt} variants={reduce ? undefined : revealItem} onClick={(event) => { if (option.quick) { setQuick(true); return } destination.current = option.to; requestClose(event.currentTarget) }}><span className={styles.icon} aria-hidden="true"><HomeServiceIcon title={option.title === '闲置' ? '二手交易' : option.title === '任务' ? '我的待办' : option.title === '贴便签' || option.title === '记一笔' ? '生活互助' : '校园广场'} decorated={false} size={36} /></span><span className={styles.copy}><b>{option.title}</b><small>{option.desc}</small></span></motion.button>)}
    </motion.div>
    <p className={styles.note}>选择一种分享方式，继续填写文字、图片与详情。</p>
  </DialogLayer>
    {quick ? <QuickRecordSheet key={owner} owner={owner} onClose={onClose} /> : null}
  </>
}
