# Windows 窗控主题背景修复验证记录

日期：2026-10-09。基线：`cd133e1`。范围：用户反馈的右上原生最小化/最大化/关闭组背景及主题同步。

## 实现和独立审核

原先 `titleBarOverlay.color` 为固定纯色，覆盖真实面板底色和纸纹；React 设置或系统主题更新也没有同步原生控件。共享外观 helper 现使用透明 `#00000000`，让当前面板表面连续显示，符号和窗口启动底色使用真实 Web 主题令牌。主窗口监听已提交 state 和系统事件，启动订阅先于首屏加载；维修与重定位窗口复用透明配置。

方案、测试清单、实现均经独立子代理审核。code review 发现的首屏加载期系统主题竞态已用旧代码失败的回归修正并复审通过。没有改变 React 业务组件、桌面安全区、44px 原生控件高度、数据流程或协议。

## 自动验证与产物

运行环境为 Windows x64、Node 24.19.0、Electron 44.6.0。忽略目录 `docs/evidence/window-controls-theme/` 保存实际运行记录，公开说明不收录作者资料或密钥。

- `node --import tsx --test tests/unit/window-appearance.test.ts`：12 tests / 12 pass / 0 fail / 0 skipped；独立复跑同样通过。`red-host.tap`、`red-startup.tap` 保留旧 main 的实际失败。最初 red 中 host 的 ASI harness 错误不算产品失败证据；其中三个旧 constructor 的固定背景失败有效。
- `tsc --noEmit`：exit 0。`npm run build`：exit 0，Prisma、Next TypeScript/静态页面及 desktop 编译完成。
- `node scripts/package-desktop.mjs`：exit 0，314 项包内项目资源核对通过，包内依赖探针 exit 0、PGlite 正常关闭。这是 Node 资源/依赖探针，不是安装包的 Electron 原生启动验收。
- 当前编译主进程和 `release/win-unpacked/resources/app/dist/main/index.cjs` SHA256 均为 `3AF5100F144DA4BDDCC7D32B4860EB64A07A5059EE525E56C3B68DE4F27316A9`。
- 安装包：`release/XaanInk-0.1.0-win-x64.exe`，276569769 bytes；SHA256 `A713F40BEE5F7A8BAD77015F1D36CCE0E6822DB52462A22DCF534ECDC02FA3B8`。没有执行安装或发布。

构建与测试前为现有命令目录的原始字节校验临时恢复 LF：逐个与已保存 SHA 比较后，仅调整换行。结束后恢复这些原有文件及生成路由的 checkout 格式，不把换行变化纳入修复。

## 全量验证失败

首次 `scripts/test-core.mjs` 使用现有 120 秒全局限制，实际超时，不能视为通过。随后对全部 244 个 unit/integration 文件以 `--test-concurrency=2` 重跑：exit 1；最终 footer 为 **1678 tests / 1558 pass / 117 fail / 1 cancelled / 2 skipped**，包含嵌套测试，不用 1648 个顶层条目替代最终统计。四个挂起的隔离数据锁/目录迁移 Node 文件子进程核实身份后分别于 309、224、204、264 秒结束，按失败/不完整保留在 `core-hung-files.json`；因此本次不是无中断全量通过。没有将失败跳过或改写断言，原有 skipped 保持原结果。

全部 27 个 browser 测试文件以系统 Chrome、`--test-concurrency=1` 运行：exit 1；199 tests / 174 pass / 25 fail / 0 cancelled / 0 skipped。

独立只读诊断见 code-review 记录：数据锁审计失败报 `AUDIT_DURABILITY_UNCONFIRMED`；配置/对话文件级加载失败是 esbuild `spawn EPERM`；browser lease 组的既有 mock 缺少当前组件所需导出。相关源码与基线相同，调用链未进入新外观 helper。其他冷源、导出、剪贴板和路由失败也保留为失败，没有证明具体系统根因或历史发生时间。**全量没有通过，不作全部业务或跨平台通过声明。**

对 `configuration-files-review.test.ts`、`conversation-chat-lifecycle.test.ts` 单并发复核：exit 0，21 tests / 21 pass / 0 fail / 0 skipped，见 `load-failure-rerun.tap`。复核支持先前加载错误的范围判断，不覆盖首次全量结果，也不声称所有失败均由并发引起。

全量中的 M71-10 另有本次相关的测试适配失败：旧 AST harness 抽取实际 `createWindow`，但未注入新依赖 `nativeWindowAppearance`，因而报 ReferenceError。已添加真实 helper 的导入与依赖注入，未改变产品代码或断言；`main-harness-rerun.tap` 为 exit 0、11/11 通过。全量数字为此次 harness 适配前的运行，不能将这项也归为未改源码的基线失败；最终关联回归采用适配后的单文件结果。

W71-01 的维修窗口测试也需适配新的真实 background：旧预期 `#faf5e8` 改为 `#f4edda`。其先行 preload 路径断言仅增加 Windows 分隔符兼容（`/` 或 `\`），保留 preload 目录及 maintenance.cjs 文件边界，使颜色与原有数据安全断言能在本机执行。`maintenance-window-rerun.tap` 为 exit 0、6/6 通过，仍是实际模块搭配受控原生 ports 的单元验证。首次全量在路径断言处失败、未到达旧颜色断言，不能把新颜色描述为当次已观察失败或原生界面通过；其他 RW33 路径/数据提交失败未修改。

## 真实 Windows 验证范围

使用全新隔离根目录与合成作品夹具、真实 React 工作台，在 Electron 44.6.0 下从 `xaanink` 本地协议启动；renderer CDP 离线。此条件不等于系统断网，也不是安装包启动验收。

`native-paper.png` 包含实际 Windows 原生三个按钮。正常窗口、paper 主题、系统当次为暗色、右栏隐藏且无 Tab 时，caption 背景和相邻顶部纸纹连续。`native-paper.json` 的 renderer 为 paper/revision 1、启动背景为 `#F4EDDA`；仅证明这一次真实界面状态。

用户物理 Escape 中止 Computer Use 后，停止全部原生 UI 操作并关闭隔离验证进程。未完成 ink、设置即时切换、跟随系统变化、hover/非活动状态、右栏/Tab 布局变化、最大化/复原/最小化/关闭交互、跨进程主题保留及新安装包的原生离线启动。单元回归和构造 AST 检查不能替代这些项目。

W03 只追加有限开发证据，正式状态保持 `planned`，不将本修复标为完整 DESK-W03 验收通过。
