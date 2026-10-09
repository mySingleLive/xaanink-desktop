# Windows 窗控主题背景技术方案独立审核

日期：2026-10-09。阶段：技术方案审核。结论：**通过，可进入测试用例独立审核；未发现阻断方案的问题。** 本结论不等于实现、真实 Windows 效果或验收已通过。

## 范围与依据

已核实 `docs/reviews/2026-10-09-window-controls-theme-plan.md` 存在并完整阅读。仅检查该方案及 `desktop/main/index.ts`、`desktop/main/root-maintenance-window.ts`、`desktop/main/root-relocation-window.ts`、`src/app/globals.css`、`src/app/desktop.css`，未改动实现或测试。

源文件命令：`rg -n -A 68 '^function refreshMenus|^async function createWindow' desktop/main/index.ts`；`rg -n 'backgroundColor|titleBarOverlay|let theme|const theme|closed|state.revision|menuRevision|nativeTheme.on' desktop/main/index.ts desktop/main/root-maintenance-window.ts desktop/main/root-relocation-window.ts`；读取上述 CSS 的令牌、纹理与原生窗控安全区。

## 审核结论

1. 原因成立。主窗 `index.ts:652–653` 将 caption 固定为 paper card `#faf5e8` 或 ink popover `#171312`；实际 background 令牌分别为 `globals.css:127` 的 `#f4edda` 与 `:198` 的 `#0d0b0a`，editor/sidebar 另有色值，且 `:302–325` 有整窗纸纹/噪点。透明 caption 能沿用底下实际 React 面板及纹理，不要求渲染器猜测当前面板颜色。
2. 原生 API 路径合理。[Electron BrowserWindow 文档](https://www.electronjs.org/docs/latest/api/browser-window#winsettitlebaroverlayoptions-windows-linux) 支持覆盖层 CSS 色值、符号色和高度的更新；[上游问题 #48193](https://github.com/electron/electron/issues/48193) 明确记录透明 caption 可显露底色，也记录过 hover 反馈缺陷。故文档能支持方案方向，但本机 Electron 44.6.0 的普通、悬停和非活动窗口效果仍须真实验证。
3. 实时同步入口足够。设置提交 `index.ts:479–509` 与配置导入 `:386–388` 都在成功持久化后 `send({type:"state"})`；复用 `refreshMenus(state)` 的 `state.revision < menuRevision` 门（`:592–596`）可统一拒绝旧状态的主题回退。主题缓存必须保留 **选择值** paper/ink/system，系统变化时再解析有效主题，不可只缓存已解析的 paper/ink。
4. 重开与生命周期可安全实现。`createWindow()` 对 repository 的真实 `read()`（`:652`）初始化 constructor；随后 `refreshMenus(state)`（`:685`）允许 **同 revision** 再应用配置，因此不可将比较条件改成 `<=`，否则重开窗口可能漏掉初始化。缓存已提交选择值应独立于是否存在窗口；应用时先判空和 `isDestroyed()`。系统更新使用同步缓存和当次系统值，避免异步 read 返回后落到另一窗口或旧状态。原有 `closed` 清理（`:683`）需保留。
5. 三窗口策略一致且未扩大业务。维护窗口 `root-maintenance-window.ts:31–33` 已得到有效主题，重定位 `root-relocation-window.ts:41` 使用本次系统快照；两者 body/runner 主题是静态快照，应复用透明配置而保持其既有主题与业务生命周期，不单独订阅系统变化导致原生符号与 body 分离。
6. 符合本次批准边界。方案保留 Electron 原生按钮及 44px 高度、保留 `desktop.css:10` 的 native overlay 安全区，不替换 Web 的 React 业务组件、不使用设计预览、不增加任意颜色 IPC 或服务。最小 BrowserWindow 接口的纯 helper 有利于测试，且无需引入 Electron 模块的初始化副作用。

## 后续必须核对的事项

- 测试应覆盖复用门的实际调用结构：初始 read、同 revision 的重开、旧 revision 拒绝、配置导入和设置提交两条入口，以及无窗口时缓存更新。
- Windows 真机需核对显式 ink 配合系统浅色、显式 paper 配合系统深色时的符号和 hover 反馈；截图需包含 native caption。透明背景通过网页 capturePage 或纯 mock 并不足以证明。
- CSS 令牌是本次主进程颜色常量的真实来源；测试需将 background/foreground 映射与这两套令牌比对，防止后续主题调整留下新的固定色差。

本次只新增此审核记录。未运行测试，未声明其他业务或跨平台通过。
