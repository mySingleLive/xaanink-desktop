# macOS 侧栏恢复按钮实现独立 Code Review

2026-10-09（Asia/Shanghai）。审核当前精确 diff、新增 `tests/browser/sidebar-restore-safe-area.test.ts`、`scripts/smoke-sidebar-restore-safe-area.mjs` 以及 `/private/tmp/xaanink-sidebar-safe-red.log`。只写此报告，不修改实现、测试或其他人的文件。

结论：**无阻塞代码问题，批准进入 GREEN、全量活动测试与真实 macOS 验收。** 本审核不替代测试执行，也不提前授予 W05 整组或 Windows/安装包通过。

## 实现判断

- 产品 diff 仅涉及 `src/components/layout/ChatPanel.tsx:1667–1675` 的说明及恢复按钮 inline `marginLeft`。触发条件仍为 `sidebarHidden && onShowSidebar`，回调、语义标签、尺寸、点击和无拖动行为未改；标题容器、分栏、动画及业务组件未改，因此 146 所指出的展开态 spacer/transform 夹具边界没有被本次实现触发。
- 分支使用已订阅的 `desktopBootstrap?.platform === "darwin"`，无 bootstrap/Web 与 win32 的 inline style 均为 undefined，保留现有 `-ml-1.5`。darwin 的 inline style 覆盖该 class：标题 `.75rem` padding 加 `calc(88 / zoom px - .75rem)` margin 得到 `88 / zoom`，再乘真实 `setZoomFactor` 是 88 个原生窗口逻辑像素。`appearanceSchema` 的 zoom 0.75–2 合同保证有限正值；没有新平台猜测、默认模型、网络服务或数据路径依赖。
- margin 与真实 rem 抵消，root 字号更新不改变 native 左缘；属性依赖 store 实时 bootstrap，设置状态变化会重渲染，而不是仅在首次挂载捕获默认 zoom。当前代码保留 Web 的真实 JSX，不引入设计稿或模拟业务内容。
- `tests/browser/pane-window-drag.test.ts:35` 的新增局部 `desktopBootstrap` 是旧标题 JSX 提取夹具所需依赖，platform/zoom 与该夹具现有 darwin 环境一致，没有放宽断言或修改产品 store。新增 SAFE 用例是真实当前标题 JSX及CSS的布局测试，鼠标/Enter及平台分支仍为实际渲染断言。
- native harness 的隔离数据根、真实 IPC/zoom、CUA gate、正常关闭重开和证据边界已在 146 独立审核；本轮没有发现必须改变产品实现的 harness 问题。运行前仍须完成当前源码 build，真实原生间距须主代理查看 CUA 截图确认。

## TDD 证据核对

读取 RED 完整 TAP：9 条，6 pass、3 fail，0 skipped/cancelled。失败分别是 SAFE-01 默认 native 左缘 `6px`、SAFE-02 最小组合 `3.5390625px`、SAFE-04 再次隐藏后的 `6px`，均来自 `safeLeft` 安全带实际几何断言。其余平台/展开态/无回调用例已通过，未见编译、浏览器 launch 或页面运行错误作为 RED 结果。失败数超过 SAFE-01/02 的两条，是 SAFE-04 同时复用安全几何断言的合理结果。

旧源 diff 显示恢复按钮只有 `-ml-1.5`，标题有 `px-3`，默认左缘 `.375rem=6px`，与 RED 证据吻合。独立方案和用例报告已批准后才进入 RED 和当前有限实现，流程顺序成立。GREEN、全量测试及真实 macOS 实际运行尚须主代理汇总命令/界面证据；若它们失败，应修复后重新评估，不将本审核当作替代通过结果。
