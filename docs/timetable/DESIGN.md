# 海大课表模块 · 重设计说明

借鉴开源项目，而不是从零发明：

| 借鉴来源 | 用到什么 |
|---------|---------|
| [Sleepy](https://github.com/lingion/sleepy) | 压缩课程模型、导入「解析→预览→应用」、冲突计数、替换/追加 |
| [WakeUp CSV](https://wakeup.fun/doc/import_from_csv.html) | 七列表头互通，可导入手机 WakeUp |
| [zfn_api](https://github.com/openschoolcn/zfn_api) / 自研云函数 | 正方教务抓取（Cookie / 脚本） |
| 本仓库脚本 | 本机浏览器登录 WebVPN+教务，自动提取 Cookie（替代扩展） |

## 数据模型

存 **Course[]（压缩课）**，不按周展开存库：

```ts
{ name, teacher, room, day, startSection, endSection, weeks, parity, color }
```

展示时 `expandOccurrences(courses, week)` 生成格子。

## 用户路径

```text
脚本一键同步 / 粘贴 OCR·CSV
        ↓
   预览（门数、冲突）
        ↓
  替换 or 追加
        ↓
  整周网格 / 今日列表
        ↓
  导出 WakeUp CSV（可选）
```

## 目录

```text
src/domain/course.ts     # 领域模型
src/import/pipeline.ts   # 导入流水线
src/import/wakeup-csv.ts # WakeUp 互通
src/pages/schedule/ScheduleHome.tsx
tools/timetable-sync/scripts/sync-schedule.mjs
```

超级课表本身不开源；本模块走「Sleepy 式本地课表 + 海大教务适配」路线。
