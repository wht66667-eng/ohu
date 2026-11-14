import { FoxSheetPose } from '../components/fox/FoxSheetPose'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { revealItem } from '../lib/animations'
import styles from './DiscoverPage.module.css'

export function DiscoverPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>OHU · EXPLORE</span><h1>发现校园新鲜事</h1><p>从这里出发，找到你的校园生活</p></div>
        <FoxSheetPose pose="waving" />
      </header>
      
      <main className={styles.main}>
        <motion.div 
          className={styles.cardGrid}
          initial={false}
          animate="show"
          variants={{
            show: {
              transition: {
                staggerChildren: 0.08
              }
            }
          }}
        >
          {/* 朋友圈入口已收归「我的」，这里不再重复挂载，避免两处入口 */}
          <motion.div variants={revealItem}>
            <Link to="/plaza" className={styles.card}>
              <div className={styles.cardIcon} style={{ background: 'linear-gradient(135deg, var(--pink), var(--danger))' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
                </svg>
              </div>
              <div className={styles.cardContent}>
                <h3>校园广场</h3>
                <p>查看校园动态和讨论</p>
              </div>
              <svg className={styles.arrow} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </Link>
          </motion.div>

          <motion.div variants={revealItem}>
            <Link to="/tasks" className={styles.card}>
              <div className={styles.cardIcon} style={{ background: 'linear-gradient(135deg, var(--fox-orange), var(--yellow))' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
              </div>
              <div className={styles.cardContent}>
                <h3>校园任务</h3>
                <p>发布和接取任务</p>
              </div>
              <svg className={styles.arrow} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </Link>
          </motion.div>

          <motion.div variants={revealItem}>
            <Link to="/market" className={styles.card}>
              <div className={styles.cardIcon} style={{ background: 'linear-gradient(135deg, var(--mint), var(--green))' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="9" cy="21" r="1"/>
                  <circle cx="20" cy="21" r="1"/>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                </svg>
              </div>
              <div className={styles.cardContent}>
                <h3>二手集市</h3>
                <p>买卖闲置物品</p>
              </div>
              <svg className={styles.arrow} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </Link>
          </motion.div>

          <motion.div variants={revealItem}>
            <Link to="/services" className={styles.card}>
              <div className={styles.cardIcon} style={{ background: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                </svg>
              </div>
              <div className={styles.cardContent}>
                <h3>校园服务</h3>
                <p>课表、成绩查询等</p>
              </div>
              <svg className={styles.arrow} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </Link>
          </motion.div>
        </motion.div>
      </main>
    </div>
  )
}
