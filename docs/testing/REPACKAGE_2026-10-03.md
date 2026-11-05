# 2026-10-03 保存面板与短日程修复打包

- 源码基线：`d07e7fa`，包含 `801ac37` 保存面板修复与 `d07e7fa` 短日程拖动修复。
- 版本：沿用 1.6.0 / build 12。
- 产物：`dist/日程.app`、`dist/日程-mac.zip`，生成文件不入库。
- ZIP 大小：1,151,006 字节。
- ZIP SHA-256：`17a07ec3d445273c9008d6b4e4e8666a892eb31a622dcd0ddaaf1c21788dca43`。
- 工作区已有 `python-assistant/practice_01.py` 删除和未跟踪的 `backend/`；未修改或纳入此次提交，也未打入网页资源。

## 实际验证

- 前一轮修复已执行 `npm ci`、`npm run check`：整体类型检查、核心 strict 检查、构建及 159 项测试通过；已执行 Chromium 保存按钮、短日程移动及缩放验证。此次打包未重复运行完整回归。
- `bash macos/build-mac-app.sh`：前端重新构建、Swift 编译、ad hoc 签名及 ZIP 生成通过。
- `codesign --verify --deep --strict --verbose=2 dist/日程.app` 通过。
- 资源清单中的 11 项网页资源与工作区逐文件一致，包内网页目录无额外文件。
- `unzip -t` 完整性检查通过；解压后全部文件与原 App 一致，解压 App 严格签名验证通过。
- 检查脚本第一次读取 unzip 输出时遇到中文文件名的 UTF-8 解码错误；改用字节读取及容错显示后检查通过，未修改压缩包。

## 未验证范围

未启动原生 GUI、未替换已安装 App、未执行真实 iCloud/iPhone 或线上 Supabase 验收；未进行 Developer ID 签名或 Apple 公证，未推送或部署。

## 待办类型修复后重新打包

- 源码基线：`9efb9c5`；沿用 1.6.0 / build 12，更新同路径 App 和 ZIP。
- 修复阶段 `npm ci`、`npm run check` 全部 162 项通过；旧逻辑下新增界面回归确认失败，修复后通过。
- ZIP 大小：1,151,127 字节；SHA-256：`f611446239ebf92bde0cea017628d76d784e6aa9c6b61e8f6224c29fe312229b`。
- 打包、App 严格签名、11 项资源一致性、ZIP 完整性、解压全部文件一致性及解压 App 签名验证通过。
- 未替换已安装应用，未验证原生 GUI、真实同步或 Apple 公证，未推送。
