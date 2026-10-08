# 顶部拖窗修复：重新打包独立审核

2026-10-09（Asia/Shanghai）。范围为用户本轮“重新编译打包一版”。仅写本审核；未自行构建、运行原生 UI 或操作用户数据，未改生产代码。

## 打包方案与测试范围

已读取 `package.json`、`electron-builder.config.cjs`、`package-desktop.mjs`、`packaging-runtime.mjs`、`prepare-package-resources.mjs`、`inspect-packaged-app.mjs`、`packaged-resource-probe.cjs` 和当前 package 测试。**配置/验证方案审核通过，最终产物结果待复查。**

- `npm run package` 先实际 generate → UI 静态导出 → desktop bundle，再打包。platform/arch 与本机必须一致，锁定 Electron 44.6.0 和 native Sharp/libvips 的版本/架构不匹配会在 builder 前拒绝。macOS 配置输出 DMG + ZIP；publish=never、签名/公证关闭。该结果不能授予其他目标系统包通过。
- 项目资源按正向清单收集，保留五个当前 main/service/preload 入口、离线 UI/字体/Monaco worker、迁移和许可证。源代码、测试/审核证据、设计稿、map、环境文件、数据库和退役 application restore worker 均排除。afterPack 比较当前所有所需资源输入的 SHA-256，不允许缺 service、worker、字体或包外模块回退后仍生成合格产物。
- 静态验包覆盖真实 Info.plist/入口/版本、菜单中文资源、实际 native 架构、文件 manifest 和项目资源。包内依赖 probe 在临时 cwd、无 NODE_PATH 下运行，严格拒绝模块解析逃出 app，禁止 HTTP fetch，实际 Sharp 转码、Prisma compiler WASM 和 memory-only PGlite 查询/正常关闭。该 probe 的范围是 Node 中的包内资源，不能替代 Electron 启动。
- `test:package` 的候选范围为配置 4、实际资源 4、ZIP 2、packaging113 审核 4，共 14 条：配置/匹配器/版本架构、当前真实 app 输入比较、缺 service 和同时遗漏输入/包资源的拒绝、icon/license provenance、包内依赖、ZIP CRC/路径/文件清单与选定核心文件 hash、截断 ZIP 拒绝，以及 Windows builder 的录制 dispatch。后者只验证安装 builder 的资源编辑条件，不能报为 Windows 包或目标系统验证。
- 现有 ZIP 测试核对全文件路径列表及核心文件 hash，不声称每个 ZIP 条目的 bytes 全等；DMG 尚须实际产物/镜像核验或明确仅交付生成结果。本轮进一步产物/hash 检查以主代理最终证据为准。

已确认旧 `acceptance-packaged-macos.mjs` 固定 phase43 evidence、历史授权、冻结 hash 及默认用户根；不适用于当前包。实际打包应用启动应使用新显式隔离根和真实 packaged executable，验证离线协议、无模型、实际顶部拖动 DOM/CSS、错误/网络/监听状态与退出；只能记录为本轮离线启动冒烟，不扩写业务验收。

初审时 `/private/tmp/xaanink-pane-drag-repackage.log` 已显示 macOS arm64 的 afterPack resources 314、PGlite 正常关闭、publish never、跳过签名，并开始当前 ZIP/DMG 输出；尚未据此宣称最终文件生成、测试或 packaged Electron 启动通过。

最终复查通过门：当前 package 命令正常完成；`test:package` 与 `package:check` 实际结果；DMG/ZIP/app 的新产物与 SHA-256；包内文件与当前 build 输入一致；新隔离数据根实际已打包 app 离线启动和关闭证据。保留原顶部拖动生产源码 hashes，避免把重建的旧输出当作当前修复包。

## 最终产物与实际运行复查

**最终复查通过。** 已读取 `141-pane-drag-repackage.md`、implementation-45 的实际日志、最终/失败 startup JSON、观察脚本和截图；本审核没有自行重新构建、启动 app 或操作 UI。

- 重新打包日志到 `stage=packaged`，列出当前 DMG/ZIP；`package-tests.log` 为 14 tests / 14 pass / 0 fail / cancelled / skipped。`package-check.log` 为 passed=true、0.1.0、arm64、27011 文件、314 项项目资源、21 条包内外部依赖解析。DMG 日志明确 `checksum ... is VALID`；主代理记录各执行进程正常 exit 0。
- 独立只读计算实际 DMG/ZIP 的文件字节数与 SHA-256，完全等于 `artifacts.json` 和 141：DMG `335401091` bytes / `9515e940dfbdbfcb4f0055c81a54ac0098dafaecbdb1e7fa8780e324fa17ac75`；ZIP `350268743` bytes / `086eeab40761a3b0137a1454cba74f8e8ed362ff2ebd89cec5a8796bfa762695`。
- 独立只读调用 `verifyProjectResources`，当前打包 app 的 314 项资源与当前 build 输入全部相等；读取当前 static manifest 的版本/架构/品牌/文件/依赖计数并验证非依赖 app 文件的实际 SHA-256 与 manifest 一致。三份顶部拖动生产源码的 SHA-256 仍与上一轮已独立审核的 implementation-44 原生记录一致。未以旧 phase43 冻结文件替代本包输入。

最终 startup 是独立实际 packaged executable 进程 78110；JSON 为 status=passed、app.isPackaged=true、appPath 指向本轮 release app、版本 0.1.0、sandbox=true、userData/dataRoot 均为新 `/private/tmp/xaanink-packaged-drag-WVqTpf/` 内隔离目录。Playwright BrowserContext.setOffline(true) 在 app.whenReady 后、等待工作台 ready 前施加 renderer CDP 离线；最终 online=false，本地协议/API 正常、models/novels 都为 0、requestsFailed/pageerrors 都为空。AI 与显示后的右空面板顶部均为 y=0 / h=44 / drag，截图保留真实空工作台和 composer。正常退出 code=0、signal=null。

主进程两个 loopback TCP listeners 分别按实际 Node inspector port 58036 和 `/json/version` 的 Chromium DevTools websocket 响应识别为测试调试端口；脚本没有把它们当作产品 HTTP 服务，也没有声称检查全系统所有进程监听。该 CDP 条件不等于操作系统断网。本轮截图/DOM/CSS 只核验包中当前顶部结构，不授予新的三处物理拖动或完整安装包原生交互验收。

两份早期失败记录完整保留：首次因 Session emulation 后 online=true 断言失败而 status=failed，正常关闭不被当作离线通过；第二次因不合适的 Session fetch 探针失败，明确记录本任务隔离进程 76610 最终 SIGKILL，code=null，未计作正常退出通过。最终采用现成 Playwright context offline 的新隔离独立进程正常退出，没有修改安装包/生产代码以绕过断言。

141 与新增 W04 development.repackage / migration 根部 repackageEvidence 精确限定为当前 macOS arm64 包生成、14 项 package 测试、静态验包/DMG 完整性和 renderer 离线启动冒烟。W04 总 status 仍 planned，原业务迁移条目没有授予通过，上一轮 1800 项开发测试未被宣称本轮重跑。Windows、系统完全断网、全业务及完整安装包原生物理交互保持未执行。最终 `git diff --check` exit 0；无剩余本轮打包审核发现。
