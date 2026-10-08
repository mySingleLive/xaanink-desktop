# macOS 侧栏恢复按钮测试用例独立审核

2026-10-09（Asia/Shanghai）。审核 `145-sidebar-restore-test-cases.md` 与 `tests/browser/sidebar-restore-safe-area.test.ts`。本审核只写此报告，不修改实现或测试。结论：**批准按 SAFE-01/02 先取得真实几何 RED，再实现并验收 GREEN；无阻塞发现。** 本报告是用例审核，没有运行测试，不能作为通过证据。

## 已确认覆盖

- 测试通过 TypeScript AST 提取当前 `ChatPanel.tsx` 中 `desktop-drag h-11` 的标题 JSX，并编译仓库真实 Tailwind 与 desktop CSS；恢复按钮没有在夹具中复制。React state、Zustand bootstrap 和回调是明确标注的夹具，职责限于隔离标题布局。
- SAFE-01/02 的判断对象是实际按钮 `boundingBox().x * zoom`，安全带 84–96px 对旧 `.375rem` 左缘产生可辨识的失败，不以实现字符串或固定 style 值代替几何。RED 只能接受这些几何断言失败；缺浏览器、JSX 编译错误或运行错误不算 RED。
- SAFE-02 同一实例通过已有 desktop store 改变 zoom，配合 DesktopApp 当前 `16 * font / 14` root rem 规则，覆盖 5 个 zoom × 3 个字号，包含 .75/2 与 11/24 四个交叉边界，能发现固定 CSS px、只减固定 12px 或遗漏 zoom 抵消。
- SAFE-03 覆盖 win32 与无 bootstrap 的原 `.375rem` 位置，以及所有平台侧栏展开/无恢复回调时按钮不渲染；SAFE-04 覆盖鼠标恢复、重复隐藏后恢复、Enter 键恢复、右栏恢复回调，并检查真实 CSS 的 drag/no-drag 属性。相关 callback 调用次数断言能够发现重复触发或误触右栏行为。
- SAFE-05 明确由完整真实 Electron/DashboardShell/SidebarTree/ChatPanel 补足浏览器夹具没有执行的分栏动画、真实原生缩放、真实 IPC 设置落盘、重开恢复折叠布局与原生按钮可视证据。新空 `XAANINK_TEST_ROOT` 及离线协议隔离真实用户数据；原生截图采用 CUA，不能把 renderer 截图称作原生窗控证据。
- SAFE-06 包括全部活动 unit/integration/browser、完整 typecheck、UI/desktop build 和 diff 审查；退役备份用例与旧安装包不用于替代当前修复验收，Windows 无目标机器时保持未执行记录。这与本次 W05 有限修复、W04 拖动回归的范围一致。

## 夹具边界与验收注意

浏览器测试的恢复按钮位于左缘为零的孤立 chat 容器，不执行 Sidebar 动画，也未调用 Electron `setZoomFactor`；乘 zoom 是对预期原生坐标的布局推导。因此真实 macOS 仍须记录 chat 左缘、真实 zoom、恢复按钮边界，结合实际绿灯右缘截图确认间距；多次切换及重开后按钮可点击且窗口没有被关闭。

“展开态无保留区”现有浏览器断言检查按钮数量和标题 padding，不能单独排除未来额外插入的 spacer、transform 或其它子元素 margin。针对本轮仅给条件恢复按钮增加 inline margin 的实施方案，这不是阻塞遗漏；独立 code review 应确认实际 diff 仍限于该按钮，若实现扩大到标题容器/spacer，必须补充展开态实际几何断言后再验收。原有展开侧栏 spacer 未抵消 zoom，边界下若发现既有独立问题应据实记录，不掩盖为本次修复已解决。

## Native harness 补充审核

继续静态审核 `scripts/smoke-sidebar-restore-safe-area.mjs` 对 SAFE-05 的覆盖，结论：**脚本可进入真实运行；未发现阻塞缺陷。** 此处仍不是执行结果。

- 脚本限定实际 `process.platform === 'darwin'`，用 `mkdtemp` 创建此前不存在的数据根并将其通过 `XAANINK_TEST_ROOT` 传入 Electron，验证 bootstrap 指向该 root、模型/作品为空、URL 为 `xaanink://app/`，再将页面设为 offline。清理只删除本次生成的临时目录；证据留在仓库指定目录。
- `observe()` 同时读取主进程真实 window/content bounds、`webContents.getZoomFactor()`、原生按钮位置以及 renderer 实际几何/drag 属性。矩阵通过真实 `window.desktop.settings` IPC 更新，等到 root font 已应用再读真实 zoom，覆盖 5 个 zoom × 2 个字号边界。浏览器夹具的模拟缩放不会代替该结果。
- 三个具名 gate 供 CUA 留下原生默认/最小/最大边界截图；恢复 gate 要求 CUA 点击后 sidebar 实际展开、恢复按钮消失，并断言原生窗口位置/状态/zoom 未改变。ack 记录截图路径及 SHA-256，以便将人工观察与运行报告关联。脚本只检查截图存在且大小合理，**实际截图确有当前原生绿灯及右侧恢复按钮间距，仍由主代理独立查看确认**。
- 反复恢复包含真实鼠标首次恢复及 Enter 两轮；设置回到默认后退出和重启，验证隐藏布局仍恢复且 Enter 可重新展开。已检查本地 `node_modules/playwright-core/lib/coreBundle.js:44177–44185`：Electron context close 调用 `app.quit()`，项目 `desktop/main/index.ts:300–304` 会进入真实 `before-quit` 保存关闭协调，因此不是仅杀进程伪造正常重开。

保留四项证据边界：① 脚本在 `waitCollapsed` 收敛后采样，并没有逐帧记录收起/展开的按钮轨迹；动画安全仍须按真实操作观察与有限 diff 审核说明。② report 的 `sourceHashes` 未直接校验 `dist/out` 与源文件对应关系，运行前须先完成本轮 UI/desktop build 并保留命令结果，不能运行旧 build 后称当前源码通过。③ 重开前设置为 zoom=1、font=14，重开测试证明隐藏布局/按钮可达，没有证明非默认边界外观跨重启；不可扩大结论。④ 宽窗通过 `setBounds(2200×1000)` 设定，实际结果仍受系统窗框约束影响；若返回的窗口宽度/真实 zoom 使 CSS 视口落入 900px 以下，应记录窄窗事实，不能把该帧当宽布局验收。gate ack 应由主代理在截图及操作完成后写入完整 JSON，避免部分写入时被脚本读取导致无关运行失败。
