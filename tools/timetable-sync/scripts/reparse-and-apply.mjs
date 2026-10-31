/**
 * 用桌面调试 HTML / 最新 JSON 重新解析并写入永久课表页
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { guessTerm, rowsToTable, toWakeUpCsv, walkJouDayRowSchedule } from './parse-jou-html.mjs'

const DESKTOP = path.join(os.homedir(), 'Desktop')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 站内应用根（xm-main） */
const APP_ROOT = path.resolve(ROOT, '..', '..')
const H5 = 'http://localhost:43123/'
const debug = path.join(DESKTOP, '海大课表-抓取调试.html')

const html = fs.readFileSync(debug, 'utf8')
const rows = walkJouDayRowSchedule(html)
if (!rows?.length) {
  console.error('解析失败')
  process.exit(1)
}
const term = guessTerm(html)
const table = rowsToTable(rows, term)
console.log('courses', table.courses.length, table.courses.map((c) => `${c.name}|${c.room}|周${c.day} ${c.startSection}-${c.endSection}`).join('\n'))

const payload = { term, savedAt: new Date().toISOString(), table, rows }
fs.writeFileSync(path.join(DESKTOP, '海大课表-最新.json'), JSON.stringify(payload, null, 2), 'utf8')
fs.writeFileSync(path.join(DESKTOP, '海大课表-WakeUp-最新.csv'), '\uFEFF' + toWakeUpCsv(table), 'utf8')
const pub = path.join(APP_ROOT, 'public')
fs.mkdirSync(pub, { recursive: true })
fs.writeFileSync(path.join(pub, 'last-snapshot.json'), JSON.stringify(payload, null, 2), 'utf8')

function findBrowser() {
  const local = process.env.LOCALAPPDATA || ''
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files'
  for (const c of [
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]) {
    if (fs.existsSync(c)) return c
  }
  return ''
}

const exe = findBrowser()
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
})
const page = await browser.newPage()
await page.goto(H5 + '?sync=1', { waitUntil: 'domcontentloaded', timeout: 20000 })
await page.evaluate(
  (p) => {
    localStorage.setItem('jou_tt_table_v2', JSON.stringify(p.table))
    localStorage.setItem(
      'jou_tt_snapshot_v1',
      JSON.stringify({ schoolNo: '', term: p.term, savedAt: p.savedAt, rows: p.rows }),
    )
  },
  payload,
)
await browser.close()
console.log('已写入课表页（public/last-snapshot.json + 本机兜底）')
