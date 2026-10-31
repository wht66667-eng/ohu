import { HomeServiceIcon } from './HomeServiceIcon'
import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { MenuCloseIcon } from './ui/motion-ui'
import { DialogLayer } from './ui/DialogLayer'
import { revealItem, revealShortList } from '../lib/animations'
import { useUiMotion } from '../lib/motion-pref'
import styles from './PublishSheet.module.css'

const OPTIONS = [
  { title: '朋友圈', desc: '好友可见 · 图文分享', image: 'publish-option-1.webp', width: 104, height: 97, to: '/moments?compose=1' },
  { title: '任务', desc: '发布跑腿需求', image: 'publish-option-2.webp', width: 85, height: 82, to: '/tasks?publish=1' },
  { title: '闲置', desc: '交换闲置好物', image: 'publish-option-3.webp', width: 85, height: 82, to: '/market?publish=1' },
  { title: '广场动态', desc: '分享校园近况', image: 'publish-option-4.webp', width: 104, height: 97, to: '/plaza?compose=1' },
  { title: '同学求助', desc: '向同学发出求助', image: 'publish-option-5.webp', width: 107, height: 97, to: '/info?publish=help' },
]
export function PublishSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const reduce = useUiMotion()
  const destination = useRef<string | null>(null)
  const requestClose = (element: HTMLElement) => element.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
  return <DialogLayer title="和哦狐一起发布" className={styles.sheet} onClose={() => { onClose(); if (destination.current) navigate(destination.current) }}>
    <div className={styles.handle} aria-hidden="true" />
    <div className={styles.head}><div><span className={styles.eyebrow}>OHU · SHARE YOUR CAMPUS</span><h2>想发布什么？</h2><p>和哦狐一起，分享校园里的新鲜事。</p></div><button type="button" className={styles.close} aria-label="收起发布面板" onClick={(event) => requestClose(event.currentTarget)}><MenuCloseIcon open size={20} /></button></div>
    <motion.div className={styles.grid} variants={reduce ? undefined : revealShortList} initial={reduce ? false : 'hidden'} animate="show">
      {OPTIONS.map((option) => <motion.button type="button" key={option.title} className={styles.opt} variants={reduce ? undefined : revealItem} onClick={(event) => { destination.current = option.to; requestClose(event.currentTarget) }}><span className={styles.icon} aria-hidden="true"><HomeServiceIcon title={option.title === '闲置' ? '二手交易' : option.title === '任务' ? '我的待办' : option.title === '同学求助' ? '生活互助' : '校园广场'} decorated={false} size={36} /></span><span className={styles.copy}><b>{option.title}</b><small>{option.desc}</small></span></motion.button>)}
    </motion.div>
    <p className={styles.note}>选择一种分享方式，继续填写文字、图片与详情。</p>
  </DialogLayer>
}
