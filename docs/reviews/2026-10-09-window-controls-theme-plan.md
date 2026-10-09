# Windows 窗控主题背景修复方案

日期：2026-10-09。范围：用户反馈的原生右上角最小化/最大化/关闭按钮背景与所在面板不一致。

## 原因与依据

- `desktop/main/index.ts` 的 `createWindow` 在启动时将 `titleBarOverlay.color` 固定为宣纸卡片色或玄墨浮层色；面板实际使用 `src/app/globals.css` 的 background/editor/sidebar 等令牌及纸纹，纯色覆盖无法匹配所有布局。
- `nativeTheme` 的 updated 事件只向 React 发 theme；保存设置只改变缩放和广播 state，未更新原生 caption 的背景或符号色。
- `root-maintenance-window.ts` 与 `root-relocation-window.ts` 使用相同的固体窗控底色。
- 保留 Electron 原生按钮、44px 原生高度与现有安全区，不替换原 Web 布局、窗控或业务组件。
- Electron 提供 CSS 色值及 `setTitleBarOverlay`：https://www.electronjs.org/docs/latest/api/browser-window#winsettitlebaroverlayoptions-windows-linux 。透明 caption 行为另有上游原生记录：https://github.com/electron/electron/issues/48193 。必须在本机 Windows Electron 44.6.0 验证，文档不代替实际结果。

## 实现边界

1. 新增 `desktop/main/window-appearance.ts`：解析 paper/ink/system 为有效主题；窗体启动底色使用真实 background 令牌；Windows overlay 使用透明色 `#00000000`，符号使用真实 foreground 令牌，height 保持 44。
2. 三个自定义标题栏的窗口构造复用该配置。维修/重定位页面的主题获取与业务流程保持原样，仅 caption 透明化。
3. 主窗口在已提交设置 state（复用既有 revision 顺序门）及 nativeTheme updated 时同步底色、透明 overlay 和符号色。显式 paper/ink 不受系统色变影响；system 使用当次系统值。未持久化的设置草稿不驱动原生窗控。
4. 不增加渲染器任意颜色 IPC、不读作者数据、不添加 HTTP 服务、不改变 nativeTheme 全局 themeSource。

## 顺序与验证

技术方案独立审核 → 测试清单独立审核 → 添加回归测试并记录失败 → 实现 → 独立 code review → 全量核心用例、TypeScript、完整构建/Windows 打包检查 → 隔离数据下真实 Windows 原生截图及切换/重启验证。

回归至少覆盖：浅色/深色/跟随系统、实时切换、显式主题不随系统、旧 revision 不回退、已销毁窗口与 macOS 不调用 Windows overlay、三个窗口均使用透明 caption。原生验证覆盖真实 React 工作台的空内容、右栏显示/隐藏、主题切换及重启，窗口控件继续可用；截图包含 Windows 原生按钮，不仅网页 capturePage。

原生结果只声明本次窗控主题范围；不更新其余 530 条业务/跨平台用例为通过。验收台账仅追加本次有限修复的实现和证据。
