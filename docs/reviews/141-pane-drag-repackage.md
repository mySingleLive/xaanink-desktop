# 顶部拖动修改后的重新编译打包

2026-10-09（Asia/Shanghai），用户明确要求「重新编译打包一版」。本轮使用当前工作区源码，不修改生产代码或版本号；包含 138 已验证的 AI/右侧顶部窗口拖动修改。现有方案、用例、TDD 和独立实现审核见 133–140；本次打包独立审核见 142。

已完成 `npm run package`：重新生成 Prisma Client、Next 静态 UI（包括类型检查）、主进程/服务/preload，再按现有配置生成实际 macOS arm64 `.app`、DMG、ZIP。Node 24.18.0、Electron 44.6.0、应用版本 0.1.0；使用匹配本机的本地运行库。publish=never、签名/公证禁用，未安装到 Applications 或发布外部服务。

| 产物 | 精确字节数 | SHA-256 |
| --- | ---: | --- |
| `release/XaanInk-0.1.0-mac-arm64.dmg` | 335401091 | `9515e940dfbdbfcb4f0055c81a54ac0098dafaecbdb1e7fa8780e324fa17ac75` |
| `release/XaanInk-0.1.0-mac-arm64.zip` | 350268743 | `086eeab40761a3b0137a1454cba74f8e8ed362ff2ebd89cec5a8796bfa762695` |

本轮实际执行结果：

- `npm run package` exit 0；afterPack 对项目输入逐项验证，包括离线字体、Monaco worker、迁移、许可、平台库和包内依赖。
- `npm run test:package` exit 0，**14/14 通过、0 fail/cancelled/skipped**。覆盖实际内容/架构/入口/版本、ZIP 全条目 CRC 与文件表、缺资源及截断拒绝、ICNS/ICO 解码、包内 Sharp/PGlite/Prisma 和已安装 builder 过滤/派发条件。Windows 派发用例仍是明确记录的本机 conditional/port 检查，不是 Windows 安装运行。
- `npm run package:check` exit 0；实际包包含 27011 文件、314 项项目资源、21 条外部依赖解析，全部解析到包内；保存 `release/package-static-manifest.json`。
- `hdiutil verify release/XaanInk-0.1.0-mac-arm64.dmg` exit 0，磁盘映像校验和有效。
- 启动实际 `release/mac-arm64/玄印写作.app/Contents/MacOS/玄印写作`，使用新建独立空 dataRoot，不读取默认目录；实际 `app.isPackaged=true`、版本 0.1.0、sandbox=true、模型与小说数均 0。Playwright 在 app.whenReady 后、等待工作台 ready 前设置 renderer CDP offline，最终 `navigator.onLine=false`，`xaanink://app/` 与本地 `/api/novels` 可用，无 HTTP/HTTPS 资源或失败请求、无 pageerror。通过 CUA 点击「显示内容面板」，观察真实工作台和两个 y=0/h=44 的 drag 顶部，正常退出 code=0/signal=null。

实际启动证据是 **renderer 离线条件下的安装包启动/资源冒烟**，不是整个操作系统断网，也不是完整业务或新的三区物理拖动验收。主进程 TCP 监听仅为测试注入的 Node inspector / Chromium DevTools，按实际端口和 DevTools 响应核对；未把测试端口误记为产品 HTTP 服务或全进程监听验收。先前 138 的人工拖动/原生双击结果继续保留其开发版范围；本轮没有 Windows 目标系统。

本任务观察脚本初版错误地用 Session network emulation 之后的 online 标记作断言，并假定空工作台立即显示右栏；第二版尝试了不合适的 Session fetch 探针并等待。两份失败记录原样保留：`packaged-smoke-initial-harness-failure.json`（正常 exit 0）、`packaged-smoke-session-probe-failure.json`（探针等待清理，精确拥有的隔离 PID 76610 最终 SIGKILL，未记为正常退出通过）。改用现成 Playwright CDP offline 并由 CUA 显示空右栏后，上述最终独立运行通过；未更改安装包或产品代码来绕过检查。

本轮完整日志、实际包指纹、最终 startup JSON/截图、观察脚本和保留失败记录均在 `docs/evidence/implementation-45/`：`repackage.log`、`package-tests.log`、`package-check.log`、`dmg-verify.log`、`artifacts.json`、`packaged-offline-startup.json`、`packaged-offline-startup.png`、`packaged-smoke.mjs`。日志只替换机器目录前缀。14 项 package 测试与上一轮 1800 项活动开发测试分别记账，未将旧结果宣称为本轮重新执行。
