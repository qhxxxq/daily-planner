# TypeScript 整理与迁移记录

日期：2026-09-28。实际仓库：`/Users/qhx/day-planner`（原聊天目录 `/Users/qhx/日程` 已不存在）。

## 完成范围

- 8 个自有前端 JavaScript 模块、浏览器配置、Service Worker 和 JavaScript 测试迁移为 TypeScript。
- 5,422 行 UI 入口拆分为启动、状态、文件、渲染、编辑、菜单、搜索、同步等 ES 模块；入口只负责加载 bootstrap。
- 日期、事件、标签、颜色、布局计算集中到 domain；数据协议和交互状态集中到 types。
- 4,583 行样式按职责拆分，通过单一 CSS 入口按原顺序合并。
- 固定依赖锁文件，统一根目录构建、检查、测试、格式化及 Mac 打包命令。
- 发布文件由清单控制；缓存版本包含发行资源内容。测试 bundle 不进入发行清单。
- 个人 JSON 未改写；第三方 ICAL 源码仅将后缀改为 `.cjs`，SHA-256 与上游记录一致。

## 实际验证

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| 迁移前回归 | Pass | 137 通过、0 失败、0 跳过 |
| 整体 TypeScript 检查 | Pass | 应用、配置、构建脚本；UI 编译设置仍较宽松 |
| 核心 strict 检查 | Pass | 日期、状态、搜索、存储、编辑、撤销、Apple/云端同步 |
| 迁移后回归 | Pass | 138 通过、0 失败、0 跳过；新增生产 bundle 启动检查 |
| CSS 对照 | Pass | 原样式与按导入顺序拼接的新样式经过相同格式化后，非空行完全一致 |
| 第三方完整性 | Pass | ICAL SHA-256：`02b0ab420c2b3af5bd0829b12b8becdffdc2311e62070c381cc0c60b52b0b365` |
| Mac 1.6.0 编译与打包 | Pass | `dist/日程.app`、`dist/日程-mac.zip` |
| 签名与资源检查 | Pass | `codesign --verify --deep --strict`；清单逐文件字节比对；不含测试 bundle 或个人 JSON |
| 搜索基准 | Pass | 10,000 条、30 查询；构建 27.17 ms，旧扫描中位 124.93 ms，缓存查询中位 0.23 ms；仅合成算法测试 |
| 实际 GUI/设备/云端验收 | Not Run | 未进行人工点击、iCloud/iPhone 到达验证或 Supabase 线上迁移 |

## 限制

本次完成自有 JavaScript 到 TypeScript 的迁移，但不是全仓库 strict 化：UI 事件回调、ICS 第三方适配仍有隐式类型。核心 strict 检查与整体检查共同纳入 `npm run check`。VM 同步测试模拟原生传输，不能证明 EventKit 或真实设备交付。

Swift、SQL、Python 保留原语言。个人文件和备份未纳入 Git，生成的 JS/CSS、App 与 ZIP 也不提交。此次只作本地提交，未推送或部署。
