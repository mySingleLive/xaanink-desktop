# 右侧内容 Tabs 审核稿

打开 `index.html`，查看 6 DIP 小圆角矩形、上下各 6 DIP 留白、普通箭头、鼠标拖拽排序、浅中性色描边、选中底色和标题渐隐。第四版 `ink-xy-v4` 增强玄墨选中项为亮灰底色、灰色细边和浅色文字；拖拽预览保持按下点的二维偏移，同时跟随 X、Y，不再固定在标签条下方。可切换宣纸、玄墨、正常宽度、430px 窄面板及 3/14 个标签；所有标签菜单可切换和关闭项。拖到插入线松开即可排序，Escape 取消；Alt 加左右键也可排序。前三版保存在 `archive-v1/`、`archive-v2/` 与 `archive-v3/`。

调研与产品方案在 `docs/reviews/2026-10-10-content-tabs-research.md` 和 `docs/reviews/2026-10-10-content-tabs-product-design.md`。本次独立设计复审记录在 `docs/reviews/2026-10-10-content-tabs-ink-xy-design-review.md`，前三版审核保持历史结论。用户于 2026-10-10 明确批准第四版；真实 `ContentTabs.tsx`、局部交互 hook、Tabs store 和 desktop.css 已按独立技术/用例审核及 TDD 实施，不复制本稿示意工作台。实施审核见 `docs/reviews/2026-10-10-content-tabs-implementation-review.md`。

`capture-preview.mjs` 用隔离 Chrome 从本地 file URL 渲染本稿，没有监听服务。命令使用工作区 Node 24：

```powershell
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' design/content-tabs/capture-preview.mjs
```

`preview-observations.json` 及 `preview-*.png` 为设计预览的几何、主题和交互检查。Chrome 默认隐藏滚动条的参数已移除，标签条本身采用 `overflow:hidden`；所有标签弹出列表保留独立的纵向滚动。截图窗控为示意，检查结果不计产品测试、真实 Electron、macOS 或全部业务验收。产品阶段只进行用户指定的本次专项测试，不跑全量测试或全量回归。

拖拽预览的专项检查使用 `check-drag-preview.mjs`，结果写入 `drag-preview-observations.json`。它启动独立无界面 Chrome，只测试本地审核 HTML，不连接、刷新或操作用户的浏览器标签。

第四版检查结果：`capture-preview.mjs` 通过 5 个视觉场景和 6 项交互；`check-drag-preview.mjs` 通过 18 项拖拽相关用例，两者均无页面错误。改动前新增的玄墨颜色断言和二维抓取偏移断言均失败，改动后通过。`preview-ink-panel.png` 与 `preview-drag-xy-panel.png` 分别记录选中高亮及纵向移动预览。以上仅为 HTML 审核稿检查，正式组件另有专项验证和目标系统证据。

正式实现已完成，最终 45 个目标相关用例及 Windows Electron 专项通过；总结见 `docs/reviews/2026-10-10-content-tabs-verification.md`，最终目标证据为 `docs/evidence/content-tabs/target-06-electron/`。没有运行全量或全量回归。Electron 使用真实完整组件和隔离合成数据，键鼠由 Playwright/CDP 合成，不声明物理 OS、macOS 或安装包验收。
