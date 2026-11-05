# 2026-10-02 应用检查与重新打包

- 源码基线：`3082e26`，检查开始时工作区干净；本次未修改应用行为。
- 版本：1.6.0 / build 12，沿用当前版本号。
- 产物：`dist/日程.app`、`dist/日程-mac.zip`；生成产物不入库。
- ZIP 大小：1,134,762 字节。
- ZIP SHA-256：`cb26bc584f2e1a430d5afbe94793b9db3c165b3c0bc0cb7ba67a66fc18b9102b`。

## 实际验证

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| `npm ci` | Pass | 安装锁定依赖；审计 0 漏洞 |
| `npm run check` | Pass | 整体类型检查、核心 strict 检查、构建；143 测试通过，0 失败、0 跳过 |
| `python3 tests/native/check-apple-dates.py` | Pass | 生产日期转换及 EventKit 全天赋值，三个时区、夏令时、重复更新；无真实日历写入 |
| `python3 tests/native/check-apple-reminders.py` | Pass | 内存 EventKit 提醒对象、多提醒、取消、特殊提醒保留、三个时区与夏令时 |
| `python3 tests/native/check-apple-queue.py` | Pass | 20 次请求在后台编排，回调返回主线程；无真实日历访问 |
| `bash macos/build-mac-app.sh` | Pass | 前端构建、Swift 编译、临时签名及 ZIP 打包 |
| `codesign --verify --deep --strict --verbose=2 dist/日程.app` | Pass | 本机 ad hoc 签名完整性；不代表 Developer ID 签名或 Apple 公证 |
| 发行资源 | Pass | 清单中的 11 项资源逐文件与工作区一致，网页目录没有额外文件；未包含个人日程 JSON 或测试 bundle |
| ZIP 完整性与一致性 | Pass | `unzip -t`；解压后逐文件与 App 比对，解压 App 严格签名验证通过 |
| 实际 GUI、iCloud/iPhone、线上数据库迁移 | Not Run | 本次未进行人工界面操作、设备同步或云端部署；未替换已安装应用 |
| 独立 PostgreSQL 集成检查 | Not Run | 本次未运行 `tests/database/check-cloud-database.py` |

首次运行 `npm run check` 时出现 `node_modules/.bin/tsc` 的 `MODULE_NOT_FOUND`。
随后确认符号链接及目标文件存在，未修改源码，重新执行完整检查通过；未确认首次失败的根因。

本次仅提交验收记录，未推送远端；个人数据及发行包不纳入 Git。


## 同步修复后再次打包

- 源码基线：`9e6fbcb`，包含 `a554be2`、`02857ba`、`5035e30` 三项同步修复；打包前工作区干净。
- 沿用 1.6.0 / build 12；重新生成 `dist/日程.app`、`dist/日程-mac.zip`。
- ZIP 大小：1,137,710 字节。
- ZIP SHA-256：`a28bf52f3bd9442ff6dc58ea5a4a1d7106354fd0874ab918c371f2e247bec53d`。
- Pass：`bash macos/build-mac-app.sh` 前端构建、Swift 编译、ad hoc 签名及压缩。
- Pass：App 严格签名验证、11 项网页资源逐文件比对且无多余资源、ZIP 完整性、解压后全部文件一致性及解压 App 严格签名验证。
- 本轮修复阶段已执行 `npm ci`、`npm run check`（156 项通过）及原生重复检测、日期、提醒、队列检查；打包阶段未重复运行这些测试。
- Not Run：原生 GUI、真实 iCloud/iPhone、线上 Supabase、Developer ID/Apple 公证；未替换已安装应用、未推送或部署。
- 仅提交打包记录，生成 App/ZIP 不入库。
