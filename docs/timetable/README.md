# 课表查询（/schedule）

站内「课表查询」页的抓取侧与设计归档。页面代码在 `src/pages/schedule/`，
本目录只放**说明与样例**，工具在 `tools/`，云函数源码归档在 `cloudfunction/getTimetable/`。

## 目录

| 位置 | 说明 |
| --- | --- |
| `src/pages/schedule/` | 课表页（整周 / 今日 / 导入 三页签）+ `.tt-*` 样式 |
| `src/domain/course.ts` | 压缩课模型 `Course` / `CourseTable`、周次展开、节次时刻 |
| `src/import/` | 解析-预览-写入流水线（`.pipeline.ts`）与 WakeUp CSV（`wakeup-csv.ts`） |
| `src/lib/timetable.ts` | 教务接口客户端（验证码 / 账号密码 / Cookie 导入 / 免密续拉） |
| `src/lib/timetable-store.ts` | 课表存取：已登录写 CloudBase（按 uid），未登录降级本机 |
| `tools/timetable-sync/` | puppeteer 一键同步 + 重新解析脚本 + `.bat`（自带依赖） |
| `tools/timetable-extension/` | 浏览器扩展：在教务页抓会话后投递给课表页 |
| `cloudfunction/getTimetable/` | 已部署云函数的源码归档（只归档，改动需重新部署） |
| `海大课表-最新.json` / `海大课表-WakeUp-最新.csv` | 样例产物（抓取结果长什么样） |

## 一键同步怎么跑

1. 前端先起起来：在 `xm-main` 执行 `npm run dev`（端口 **43123**）。
2. 双击 `tools/timetable-sync/海大课表一键同步.bat`：
   首次会自动 `npm install`（只装 `puppeteer-core`，复用本机 Chrome / Edge）。
3. 在弹出的浏览器里登录学校 WebVPN → 脚本自动跳教务 → 登录教务 → 自动爬课表。
4. 抓完脚本写 `xm-main/public/last-snapshot.json`，并自动打开
   `http://localhost:43123/?sync=1`，页面认领后写入当前账号（未登录则存本机）。

产物同时会在桌面留一份 `海大课表-最新.json`、`海大课表-WakeUp-最新.csv`，
其中 CSV 可直接导入手机端 WakeUp。

## 数据模型与存储口径

- 页面内统一使用**压缩课** `Course`（一条安排跨多周，展示时按周展开），
  比按周展开的扁平行省一个数量级，导出 WakeUp CSV 也直接由它生成。
- 存 CloudBase `timetable_snapshots`（`uid` 行级安全，字段
  `school_no / term / data(jsonb) / saved_at`），`data` 存 `CourseTable`。
- 兼容旧数据：早期快照里 `data` 是扁平 `TtRow[]`，读取时会自动
  `rowsToCourses` 迁移为压缩课并回写，老用户课表不会丢。
- 未登录：写本机 `localStorage['jou_tt_table_v2']`；登录后自动归入账号。

## 样式说明

课表页样式沿用并入前的 `.tt-*` 类名，色板在 `src/pages/schedule/schedule-theme.css`
里从暖橙映射到站内「阳光」绿色 token，只作用在 `.tt` 作用域内，不影响手机壳与其它页面。

## 安全

学号 / 密码 / 验证码 / Cookie 只在单次请求内存中传递：
不写 localStorage、不进 console、不出现在任何日志里；持久化的只有课程数据与学号。
