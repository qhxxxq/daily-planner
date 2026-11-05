# Apple 有限双向同步验证（2026-09-18）

> 本文保留各版本当时的验收记录。2026-11-05 已移除 Supabase 同步及数据库脚本；下文云同步测试和路径仅描述历史版本，不能作为当前部署步骤。当前功能及命令见 [README](../../README.md)。

本次开发不读写用户的真实 Apple 日历。下表区分自动化检查和必须在真实设备上验收的部分。

| 检查 | 状态 | 证据或步骤 |
|---|---|---|
| 三方合并、双端冲突、双端删除、首次升级差异、重复导入、App 元数据保留 | Pass | `node --test tests/sync/apple-sync.test.cjs` |
| 原生连接编排：编辑保护、读取期间修改、备份失败、存储配额、写入复查失败、保存错误重试 | Pass | `node --test tests/sync/apple-sync-integration.test.cjs`，模拟桥接，不代表 EventKit 已验证 |
| JavaScript 语法、Swift 编译和 Mac 打包 | Pass | Node 检查、swiftc、`bash macos/build-mac-app.sh` |
| 常驻状态、恢复面板打开、前端控制台 | Pass | 独立 localhost 页面查看，未载入个人 JSON |
| iPhone 修改标题/时间/备注到 Mac | Not Run | 用 App 专用 iCloud 日历中的测试日程，等待 iCloud 到达 Mac，再打开 App 或等待 30 秒；核对字段及原有标签/待办状态 |
| Mac 修改回传 iPhone | Not Run | 修改测试日程并保存，核对 Apple 日历和手机；需确认 iCloud 已完成传输 |
| 手机新增、跨天、全天、夏令时边界 | Not Run | 在专用日历新增普通事项；测试前后两年的发现范围及跨夏令时日期，检查展示时间与全天结束日期 |
| 手机删除进入回收区 | Not Run | 删除可丢弃测试事项；App 应移入“恢复与冲突”，点击恢复后创建新事项 |
| 真实并发冲突 | Not Run | 断网时两端分别编辑同一测试日程，再联网；App 应保留双方版本并暂停该项写入，选择后正确收敛 |
| 关闭同步、归档、日历账户暂不可用 | Not Run | 关闭/归档后 Apple 日历应保留；账户不可用时应显示错误，不能批量删除本地事项 |
| EventKit 权限拒绝、标识变化、部分提交失败 | Not Run | 专用测试账户验证系统行为，确保错误提示及备份可恢复 |
| 旧版生成备注迁移 | Not Run | 原有“标签/待办状态/行程时间”附加文本不应进入 App 备注；在手机修改原备注后仍保留 App 私有字段 |

范围：Apple 原生重复系列及例外、移到非专用日历的事项暂缓处理；后台关闭 App 后的实时同步未实现。网页/PWA 的 Supabase 仍是旧的整份快照实现。


## 1.2 交互回归

- Pass：使用 jsdom 加载完整 HTML 和应用脚本，验证草稿恢复、关闭与切换提示、保存/放弃、光标保留、存储失败回滚、中文输入保护、日期选择器、后台更新与草稿并存。
- Pass：跨日期搜索、结果跳转、空状态、键盘选择、隐藏日历筛选、分页、文本转义，以及搜索不触发业务保存。
- 执行方式：`npm ci --prefix tests` 后运行 `npm --prefix tests test`。
- 本轮未进行真实浏览器视觉检查，也未读写用户真实 Apple 日历；以上 DOM/桥接模拟测试不能代替 iCloud 双设备验收。

## 1.3 重复课程范围修改

- Pass：完整 DOM 测试覆盖三种范围、单次挪课后的原始次序、整组换星期和撤销、仅传播已修改字段、完成状态保留、避免重复生成、其他课次草稿保护、范围草稿恢复、无效时间整批拒绝、全天与定时例外、跨天时间及存储失败回滚。
- `npm --prefix tests test`：共 55 项通过，包含原有同步和编辑回归测试。
- Not Run：真实 Mac 窗口视觉验收、批量修改后经 EventKit/iCloud 到达手机。测试不操作个人日历数据。

## 1.3.3 安全撤销与 ICS 回归（2026-09-26）

| 检查 | 状态 | 本轮证据 |
|---|---|---|
| 全部 JavaScript 自动化测试 | Pass | `npm --prefix tests test`：96 通过，0 失败，0 跳过；含原有 59 项，不重复累计 |
| 操作级撤销 | Pass | `tests/editor/undo.test.cjs` 与完整 DOM 测试：手机更新保留、批量冲突整次拒绝、新增/删除/列表排序、草稿保护、来源引用保护、保存失败重试、跨文件历史清除、文字原生撤销 |
| Apple 删除确认 | Pass | 同步纯逻辑与模拟桥接：远端仍存在、Apple ID 别名、不支持项目和混合批次失败均不推进基线；删除成功后保持幂等 |
| ICS 导入 | Pass | 纽约/墨尔本时区与双端 DST、UTC/浮动时间、自带 VTIMEZONE、COUNT/UNTIL/BYDAY、EXDATE/RDATE、改期/取消例外、全天跨日、文本转义、无效输入整份拒绝、无限系列范围提示、预览取消、存储失败回滚 |
| 原生全天日期 | Pass | `python3 tests/native/check-apple-dates.py`：三时区、单/多天、夏令时、重复赋值；无日历写入 |
| 语法、构建、包一致性 | Pass | Node 语法检查、`git diff --check`、Mac 构建、`codesign --verify --deep --strict`；12 个包内资源与源码一致，ZIP 完整且不含个人 JSON |
| 真实 Mac 窗口视觉 / iPhone、iCloud 端到端 | Not Run | 本轮不读写真实 Apple 日历；DOM 与模拟桥接不等于真实设备验收 |

产物：`dist/日程.app`，版本 1.3.3 / build 8；`dist/日程-mac.zip`。
ZIP SHA-256：`885e6cb72b027c08817e2f616de166e55c37dd8e52b12850cce7f15553b1a76a`。

ICS 范围与拒绝规则见 README 的「ICS 导入」一节。无结束日期的系列只导入 DTSTART 起两年内，不自动补充后续实例；复杂规则会明确拒绝，不宣称完整支持所有 RFC 5545 写法。

## 1.4 云同步保护、性能与模块拆分（2026-09-26）

按用户要求交付代码与迁移脚本，由用户自行部署线上 Supabase；本轮未连接或变更线上数据库。

| 检查 | 状态 | 本轮证据 |
|---|---|---|
| JavaScript 回归 | Pass | `npm --prefix tests test`：127 通过、0 失败、0 跳过（包含已有 96 项，不能重复相加） |
| 云端协调器与实际 DOM | Pass | 不同记录合并、同记录冲突、离线待上传恢复、版本竞争重试、写入期间新修改、草稿保护、删除依赖、备份/存储失败、账户隔离、退出时旧请求丢弃、错误状态与冲突按钮 |
| 真正的数据库并发与权限 | Pass | `python3 tests/database/check-cloud-database.py` 创建并销毁独立 PostgreSQL；验证创建/更新竞争各仅一方成功、旧版本拒绝、RLS 跨账户隔离、旧直接写入和匿名 RPC 拒绝、迁移重复执行保留数据 |
| 搜索交互与索引 | Pass | 连续查询复用索引；隐藏列表变化失效；跨日/午夜/全天日期准确；跨年事项只枚举可见日期；输入只写小型偏好且保留编辑器/侧栏 DOM、草稿和光标 |
| 原生后台队列 | Pass | `python3 tests/native/check-apple-queue.py`：注入权限响应后调用生产 exchange 20 次，验证请求编排不在主线程，回调全部回到主线程；无 EventKit 日历访问 |
| 全天日期与 Swift | Pass | 日期回归三时区/夏令时通过；拆分后的 Swift 文件类型检查与实际构建通过 |
| 资源和发行包 | Pass | JS 语法、`git diff --check`、离线/打包脚本资源覆盖测试；Mac 签名验证、16 项资源与源码/ZIP 一致；不含个人 JSON |
| 线上 Supabase 迁移、真实浏览器账户双设备、Mac 窗口视觉、iCloud 传播 | Not Run | 按用户选择，线上迁移自行部署；本机 DOM 和数据库测试不等于真实服务/设备验收 |

合成基准：`node tests/search/benchmark-search.cjs` 使用 10,000 条日程、30 个查询，5 轮中位数。本轮索引首次构建 19.07 ms，原扫描算法 117.85 ms，预热后的重复缓存查询 0.18 ms。该数值只测筛选算法，包含缓存命中条件，不能代表冷查询耗时或整窗渲染速度。

产物：`dist/日程.app`，1.4.0 / build 9；`dist/日程-mac.zip`。
ZIP SHA-256：`354f350dda2762f997bed3c62d510155d93c0282dce8a2fbed7f05f66f347b6c`。
迁移：`supabase/migrations/20260926_versioned_sync.sql`；新项目使用完整 `supabase/schema.sql`。

## 2026-09-26 按功能整理目录

- 前端模块归入 `src/ui`、`src/editor`、`src/search`、`src/import`、`src/storage`、`src/sync`；配置、图标和验收记录分别归入 `config`、`assets/icons`、`docs/testing`。测试使用对应功能子目录。
- 更新 HTML、PWA 资源引用，离线缓存升级至 v10。Mac 打包依据 `config/web-assets.txt` 保留目录结构，并移除生成目录中的旧布局资源。App 版本保持 1.4.0 / build 9。
- Pass：`npm --prefix tests test`，127 项通过，0 失败、0 跳过；JS 语法检查、Shell 语法检查及 `git diff --check`。
- Pass：迁移后的三个 Python 检查入口（原生日期、后台队列、独立 PostgreSQL）；未访问真实日历或线上数据库。
- Pass：重新生成 Mac App / ZIP，严格签名校验、ZIP 完整性、17 个发行资源与源码逐一比对；无旧布局残留和个人数据文件。
- Pass：整理前后个人 JSON 的 SHA-256 一致，保留原路径以兼容已绑定的数据文件。
- Not Run：本轮未做真实窗口视觉验收、iCloud 双设备传播或线上 Supabase 部署。

## 2026-09-27 Apple 日历统一提醒（1.5.0 / build 10）

- 已实现：普通相对提醒、全天当天/前一天指定时刻、提醒草稿/撤销/备份/批量编辑、手机提醒双向合并和冲突展示、待办完成/放弃后的提醒清除。App 不发送独立通知。
- 多提醒与绝对日期提醒在普通字段编辑时保留；特殊位置/邮件/声音提醒保持原生对象、App 只读；无法匹配原生对象时停止写入。旧同步基线没有提醒字段时视为空列表，手机已有提醒通过合并或冲突保护。
- Pass：`npm --prefix tests test`，137 项通过、0 失败、0 跳过。覆盖提醒设置、草稿、保存、撤销、手机多提醒及取消、并发冲突、写入确认、批量保护、单次完成不影响其他课次、待同步/已确认/未启用状态。
- Pass：`python3 tests/native/check-apple-reminders.py`，调用生产提醒适配方法，验证多提醒、固定日期、特殊提醒保留、未知标识拒绝、取消、三个时区的全天 09:00 与夏令时；仅使用内存 EventKit 对象。
- Pass：原生日期与后台队列检查、JS 语法、`git diff --check`、Swift 编译及 Mac 打包、严格签名校验、ZIP 完整性及 17 个发行资源与源码比对。发行包不包含个人日程 JSON。
- Not Run：真实日历写入后的服务器规范化、iCloud 双设备传播、App 关闭后的实际通知、设备通知权限/专注模式、真实窗口视觉验收。未部署云端。

设备验收建议：用专用测试日程依次检查提前提醒、全天当天 09:00、手机修改为两个提醒、手机取消、双端同时修改、带草稿同步、完成待办取消、App 关闭后通知。每步先确认本机 Apple 日历中的提醒，再检查手机到达与通知；验证后删除测试日程。

## 2026-09-28 TypeScript 迁移验证

此前记录中的 `.cjs` 路径属于当时版本，迁移后的测试位于同目录 `.test.ts`。当前入口是根目录 `npm ci`、`npm run check`，搜索基准使用 `npm run benchmark`。本次实现、类型检查、资源构建与打包结果见 [迁移记录](TYPESCRIPT_MIGRATION.md)。上述历史性能数值和设备验收边界继续保留，不视为本次重测结果。
