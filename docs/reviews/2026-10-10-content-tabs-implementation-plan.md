# ContentTabs 已批准设计的技术方案

用户于 2026-10-10 明确批准 `design/content-tabs/index.html` 的 `ink-xy-v4`，允许继续实现。本次顺序为技术方案独立审核、专项用例独立审核、TDD 实现及独立代码审核、专项测试和 Windows Electron 验证、总结。只测试 Tabs 及直接相关标题栏/空态/导航，不跑全量或全量回归。

## 实现边界

复用 `src/components/layout/ContentTabs.tsx`，保留 novels 查询、封面、暂定标记、正文/大纲/候选稿后缀、StagedSaveSurface、Story 附加组件及全部 map/key/hidden 面板结构。不得复制 HTML 示意数据到产品。排序保留对象 id、React key、草稿、撤销和业务面板实例。

1. `src/stores/tabs.ts` 新增 `moveTab(id, destinationIndex)`。校验存在的 id、有限整数索引；有效索引裁切到数组范围。只移动 tabs 数组里的原对象，其他状态（activeTabId、activationNonce、subTabs、panelFocus）不变，不调用场景离开 guard；无效和同位动作不发状态更新。不增加跨重启排序持久化。
2. `ContentTabs.tsx` 的非空标题栏分为 tablist 视口、track 和工具组。外层保留 desktop caption 和原生安全 padding。工具组中仍有全屏与隐藏按钮，只有溢出才显示所有标签菜单。空态的现有隐藏/恢复路径保留。
3. `src/components/layout/useContentTabStrip.ts` 管理标题溢出、当前/聚焦标签局部显露、横向滚轮、键盘 roving focus 和 Pointer Events 排序。标题以 scrollWidth/clientWidth 判断实际溢出，ResizeObserver 观察视口/track/标题；字体加载和数据变化重新测量。只调整本地 scrollLeft，不滚动工作台外层。溢出入口的预留量从实际按钮宽度及工具间距计算，避免开关入口造成反馈抖动。
4. 菜单复用现有 DropdownMenu 构件。切换为 radio item，选中后自动收起，关闭为旁边独立 menu item 并保留菜单，不嵌套按钮。标题完整换行，Escape 返回触发器；菜单自身允许纵向滚动。极窄时标签视口可降至 0，工具和安全区优先；菜单保持可达。
5. 拖拽阈值 6 DIP，鼠标左键且关闭按钮不启动。fixed 预览克隆可见标签，清理语义/焦点/重复 id，append 到 body 以避开面板祖先裁切；从源区域复制主题和尺寸变量。按下点偏移 X/Y 始终保持，预览移出视口仍跟随。插入线只在指针位于视口时显示，排序只在有效落点提交。视口边缘 RAF 自动横移，不显示滚动条。
6. Escape、pointercancel、lostpointercapture、blur、文档隐藏、尺寸变化、外部标签变化、卸载均清理拖动、capture、RAF、ghost 和 marker。拖动后的 pointer click 被拦截；下一次普通 pointerdown 重置拦截。Alt 加左右方向键提供排序，状态播报目标位置；普通左右/Home/End 只移动焦点，Enter/空格激活。
7. `src/app/desktop.css` 增加局部 Tabs 样式，不改变左栏、对话栏或通用 Tabs。44 DIP 栏、32 DIP 标签、上下各 6 DIP、6 DIP 圆角、最大 208 DIP。Windows 按现有 caption zoom 换算尺寸；面板按钮中心维持 y=16 DIP。底部分割线独立绘制，不占标签几何。选中宣纸使用右内容主体色，玄墨为 #2a2826/#4b4640/#ece7e1；普通箭头、无红边、仅长标题末24 DIP渐隐。

8. 真实 Electron 完整工作台发现 `DesktopCommandController` 的捕获阶段会先消费默认 Alt+左右导航。仅当真实标签 track 的 tab 根元素获得键盘焦点、按键为单独 Alt+左/右时，将事件留给标签排序并清空待完成的全局 chord；鼠标拖动已启动时，纯 Escape 同样留给取消 handler。关闭按钮、菜单、正文和其他焦点保留原命令行为；增加包含真实 Controller 的专项浏览器用例，先红后绿，再重建目标 UI。此修复不改命令目录或用户快捷键设置。

极窄边界细化：去掉原生安全 padding 后不足以容纳三个面板工具时，仅保留“所有标签”触发器，把全屏和隐藏操作加入同一菜单。紧凑状态由标题栏真实可用宽度决定，此时强制保留菜单，不随其显示反复切换。常规宽度工具位置和尺寸保持。拖拽封面还须禁用图像原生拖动，避免浏览器图像 DnD 中断标签排序。

## 验证与证据

专项 store 用例证明重排不触发 guard、不更换对象或其他状态，关闭按新顺序选邻项。浏览器夹具使用真实 ContentTabs、Tabs store、CSS 和 DropdownMenu，只有无关业务正文用有输入状态的组件替代，检查 React 实例保留。真实 Windows Electron 另用隔离目录运行完整组件工作台，记录版本、平台、主题、缩放、尺寸和输入方式；不冒称物理 OS 鼠标、macOS 或安装包验证。源码/日志/截图不包含真实用户数据或 Key。

源码类型检查是构建检查；Next UI 和桌面构建只为将本次修改带入 Electron 目标验证，不是全量测试。历史全量失败和其他业务状态不修改。
