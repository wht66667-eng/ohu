# F-Droid 依赖与素材许可盘点（自动初筛）

生成日期：2026-10-31。此报告只帮助逐项核验，不构成法律意见或许可证兼容结论。

## npm 锁定依赖

- 锁文件版本：3；记录包数：396。分类是 lockfile 的 dev 标记，不能代替最终 APK 的依赖闭包。
- 缺少许可证元数据：2 个。
- 包根目录未发现常见 LICENSE/COPYING/NOTICE 文件名：66 个；需查看包实际文件和上游许可。
- 完整包名、版本、元数据、常见许可文件名和 lockfile 分类见 [`fdroid-npm-licenses.csv`](./fdroid-npm-licenses.csv)。

| package.json license 元数据 | 锁定包数 |
|---|---:|
| `(BSD-3-Clause OR GPL-2.0)` | 1 |
| `(missing license metadata)` | 2 |
| `(MIT OR Apache-2.0)` | 1 |
| `(MIT OR CC0-1.0)` | 1 |
| `0BSD` | 1 |
| `Apache 2.0` | 1 |
| `Apache-2.0` | 11 |
| `BlueOak-1.0.0` | 10 |
| `BSD-2-Clause` | 5 |
| `BSD-3-Clause` | 8 |
| `ISC` | 30 |
| `MIT` | 310 |
| `MPL-2.0` | 13 |
| `Public Domain` | 1 |
| `Unlicense` | 1 |

### 缺失许可元数据

- `@cloudbase/signature-nodejs@2.0.0` (node_modules/@cloudbase/signature-nodejs)
- `@cloudbase/wx-cloud-client-sdk@1.8.10` (node_modules/@cloudbase/wx-cloud-client-sdk)

## `public/` 素材与静态文件

- 文件数：192。完整路径、大小和扩展名见 [fdroid-public-assets.csv](./fdroid-public-assets.csv)。每项目前均标记为待人工确认来源和再分发权；程序不能仅凭文件名判定版权。

| 扩展名 | 文件数 |
|---|---:|
| `css` | 2 |
| `geojson` | 3 |
| `html` | 5 |
| `ipa` | 2 |
| `jpg` | 2 |
| `json` | 7 |
| `md` | 2 |
| `mjs` | 3 |
| `ohfox` | 3 |
| `png` | 81 |
| `svg` | 2 |
| `webmanifest` | 1 |
| `webp` | 79 |

## 尚不能据此宣称合规

- 根仓库许可证仍需著作权人明确选择，并确认共同贡献者授权。
- npm 元数据可能不完整、错误或存在多许可证选项；每个最终构建依赖仍需核验其上游许可证、许可证正文、NOTICE 义务及实际进入 APK 的闭包。
- 静态资源的作者、来源、商用／再分发授权和署名条件尚未由扫描器确认；尤其要逐项核对品牌、狐狸插画、宣传图、字体、地图与词库。
- 后端服务和外部 API 的自由软件状态、服务可替换性及需要申报的 Anti-Features，仍须单独进行人工评估。
- F-Droid buildserver 干净构建和复现验证仍未执行。
