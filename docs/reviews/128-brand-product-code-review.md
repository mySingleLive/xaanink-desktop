# 玄印写作产品与矢量范围代码独立审核

2026-10-08。审核对象：本轮已完成的 `src/**` 品牌/协议/端口改动、npm 与 lock 元数据、`electron-builder.config.cjs`、产品/打包脚本、preload、commands/command-registry/generated catalog，以及 18 个品牌 SVG、`scripts/generate-brand-assets.mjs` 和 `126-brand-assets-implementation.md`。不审核尚在实现的启动路径、safeStorage 生命周期或数据兼容实现。本代理只修改本文；未读取真实作者作品或 Key，未启动真实用户环境。

## 结论

**产品与矢量范围通过；已列出的协议运行断路与旧测试 harness 同步缺口均已修正并复验。** 审核中发现的双家族打包保护回归已经修正并独立验证。最终追加定向验证为 41/41 通过；不能据本范围通过宣称全量测试、真实应用启动或数据兼容验收通过。

## 已修正的问题

P1：builder 最初只排除 `.xuanxiang`/`.xuanxiang-storage`，而 inspector 被替换成只拒绝新家族。实际安装 builder matcher 探针证明 `out/.xaanink/settings.json` 与 `out/.xaanink-storage/state.json` 原先均被允许，可能收集作者数据。修订后 builder glob 同时排除两家族，inspector 正则也同时拒绝两家族；新增 matcher 回归覆盖两家族、`out`/`out/subdir` 与普通/storage 目录共 8 个组合。实际定向测试通过。

## 独立验证与源文件依据

- `node --import tsx --test --test-concurrency=1 tests/unit/brand-product-identity.test.ts`：3 tests，3 pass，0 fail/skip/cancelled。检查真实 npm/lock、builder productName/bundle ID/安装文件名、两平台菜单、AST 中实际标题/加载文字/aria-label、DOCX/PDF creator、scheme 注册/handle、入口 URL 及 preload/transport 端口。
- `node --import tsx --test --test-name-pattern='实际 builder 项目 matcher' tests/unit/packaging-config.test.ts`：1 pass，3 项因 name-pattern skipped，0 fail。跳过的 schema/依赖 matcher/runtime 用例未在本次独立定向命令中执行。
- `scripts/macos-menu-localization.mjs` 保留 raw runtime/executable 全名「玄印写作」，只通过各原生 locale 的 `InfoPlist.strings` 显示简称「玄印」；没有用简称重命名 Electron helpers。`inspect-packaged-app.mjs` 验证 raw `CFBundleName`、display、executable、bundle ID 与版本。真实 .app 仍须组合后生成并检查。
- preload 发出、transport 接收的字面量同为 `xaanink-response-port`；UI avatar URL 和桌面下载入口使用 `xaanink`。广播登出 channel 与芯片拖拽 MIME 两端通过同一源码常量/一致 channel 更新，未更改业务正文或 ID。
- 对生成命令 catalog 的 10 个 sourceHashes 独立重算全部一致；darwin/win32 的 `app.about`/`app.quit` label 分别为「关于玄印写作」/「退出玄印」。
- 独立读取每个 SVG 与 `git show HEAD:<asset>`：18/18 的首个完整图形 group 逐字一致，width、height、viewBox 全部一致。6 套 horizontal/formal 字标的每个 glyph ID 与实际 path 均匹配现有字体 `font.layout('玄印写作')`，formal 英文 path 匹配 `font.layout('XaanInk')`，没有 `<text>` 或系统字体渲染依赖。
- 字体实际 SHA-256 为 `6fb994f703468a02b8abff77a75ec1ece966b03c7a93a213454531fffae1f53e`；内部名称 Noto Sans SC、版本 2.004，与 126 和 SVG 标记一致。复读仓库 `design/assets/NotoSansSC-LICENSE.txt` 的 SIL OFL 1.1；字体原文件与许可证未修改。生成脚本使用已有字体，未引入外部生成图片或替换原图形。
- 已用 `view_image` 独立查看 `/private/tmp/xaanink-brand-contact-sheet.png`：两主题横版/正式版均为完整「玄印写作」，正式版底部 XaanInk，字形无裁切；无文字图形与原样保留的 group 一致。
- 真实来源链接仍指向现存 `mySingleLive/Xuanxiangxiezuo-Desktop`、Web 基线 `mySingleLive/xuanxiang.ink`、Sharp notices 等原地址；复验时禁用帮助按钮已经移除旧域名 title，没有伪造新域名。主窗口原生 About copyright 为 `MIT · XaanInk`，OpenRouter `X-OpenRouter-Title` 为 `XaanInk`，新导出恢复格式为 `xaanink-recovery`。

## 组合协议与测试 harness 最终复验

首次审核发现 static UI 仍只接受旧 scheme，avatar 返回旧 URL，maintenance/relocation 的 allowlist/loadURL/trusted IPC 及各恢复窗口文案未同步。通知主代理后，独立复读全部 5 个 main 文件：当前均使用 `xaanink`、完整中文名「玄印写作」及系统菜单简称「玄印」；旧 literal 搜索在这些文件中无残留。maintenance/relocation 的内存 partition 名称也使用新英文命名，原权限、导航和 IPC 所有者边界保持。

使用 Node 24.18.0 的隔离临时 HTML 调用真实 `staticUiResponse()`：新 origin GET/HEAD 均为 200，HEAD 正文为空，CSP 的 img-src 为 xaanink；旧 origin、asset origin 与 POST 均为 403。原先新 scheme 返回 403 的运行断路已解除。真实 PNG 持久化用例验证 avatar URL 为新 scheme，18 个 avatar 用例均通过。

追加定向命令：`/Users/dt_flys/.nvm/versions/node/v24.18.0/bin/node --import tsx --test --test-concurrency=1 tests/unit/brand-product-identity.test.ts tests/unit/avatar-assets.test.ts tests/unit/local-image-transport-review.test.ts tests/unit/root-maintenance-window-review.test.ts tests/unit/root-relocation-window.test.ts`。同步前结果为 **41 tests，25 pass，16 fail，0 skipped/cancelled**。具体源码与失败定位已送主代理，本代理不修改实现或测试：

- `root-maintenance-window-review.test.ts:49` 的 mocked `fromPartition()` 仍期待 `xuanxiang-maintenance`，使 W71-01..04 在进入窗口检查前失败；W71-06 的旧 startup 片段 harness 没有注入新 `startupPaths` 依赖，报告 ReferenceError。
- `root-relocation-window.test.ts:37` 的 mocked `fromPartition()` 仍期待 `xuanxiang-root-relocation`，使 10 个窗口用例在进入后续断言前失败。其原旧 marker 夹具是合法兼容测试资料，不应因分区名同步而整体替换。
- `local-image-transport-review.test.ts:57` 的 AST selector 仍要求 protocol.handle 的参数为 `"xuanxiang"`，因此 IMG60-03 找不到当前新 handler。该文件按 main.ts 默认解析为 TS；问题是 selector 旧字面量。

主代理同步上述非持久化协议/partition/menu label 与新 startup 片段依赖后，本代理复读 diff：安全拒绝、权限、同一窗口所有者、picker drain、真实 handler bytes/HEAD/CSP 与旧 marker 字节保留断言均保留；没有用整批替换 legacy fixture 消除兼容检查。再次执行**同一 Node 24.18.0 命令：41 tests，41 pass，0 fail，0 cancelled，0 skipped，duration 7829.861 ms**。先前 16 个 harness 失败已关闭。

首轮追加命令误用了 shell 默认 Node 20.20.2，出现不支持 `Promise.withResolvers` 的额外失败；随后已用项目要求的 Node 24.18.0 完整重跑，上述 41 项结果来自有效 Node 24 命令，不把不受支持运行时的失败当作产品回归。

启动 helper、旧/new safeStorage 身份、真实原生启动/退出重开、封包与全量用例继续由后续独立审核和实际目标系统证据验收；本报告没有将静态 3 项通过写作整组业务通过。
