# 右侧内容 Tabs 重构调研

本次改动解决右侧内容区顶部标签条的滚动条、布局和长标题截断问题，并增加用户最新要求的鼠标排序。结论是继续复用真实 `ContentTabs`，采用无可见滚动条的溢出视口、独立的文字渐隐和所有标签菜单。用户 2026-10-10 的第四版修订要求玄墨选中项参考附图提高亮灰高亮，并让拖拽预览同时跟随鼠标 X、Y 位置。小圆角矩形、普通箭头、上下等距留白与去掉红边继续生效。最新产品设计和 HTML 以此为准。用户本次指定的 HTML 审核和专项测试顺序优先于仓库此前的自动推进及全量测试约定。

## 当前结构与问题

| 证据 | 当前行为 | 对本次目标的影响 |
| --- | --- | --- |
| `src/components/layout/ContentTabs.tsx:96–111` | 标签条下边框；滚动容器 `top-px`、`overflow-x-auto` | 横向溢出产生可见滚动条；容器位置也参与底缘对齐 |
| `src/app/desktop.css:13–24` | Windows 标题栏 44 DIP，底部留 12 DIP；Tabs 高 32 DIP，容器被覆盖为 `top:0` | 原为保持按钮位置添加的下方留白作用于 Tabs，底缘不能连到 y=44 的分割线 |
| `src/components/layout/ContentTabs.tsx:127–150` | 原有最大宽度、`min-w-24`，标题 `truncate`，类型后缀单独显示 | 长标题以省略号结束；极窄视口可能无法完整容纳一项 |
| `src/app/desktop.css:31` | 宣纸右面板 `--editor-bg` 为 `#f8f3e4`，局部 `--sidebar` 也同色 | 选中项应直接使用主体令牌；未选中项可用透明背景和弱文字区分 |
| `ContentTabs.tsx:49–66` | 激活项自动滚入视口，ResizeObserver 处理尺寸变化 | 需要保留自动显露；隐藏滚动条不能让标签失去可达性 |
| `ContentTabs.tsx:204–216` | 按已打开 Tabs 保留面板实例，仅隐藏未激活面板 | 外观改造不能改变此结构或重挂载编辑器 |

用户截图与以上源码对应：标签下方出现横向滚动条，标签与标题栏底部分割线之间留有空白。截图只作为用户指出问题的参考，不将截图中的作品标题写入设计夹具或产品。

## 官方资料与方案比较

`overflow-x:auto` 会在溢出时由桌面浏览器提供滚动条；`hidden` 裁切内容且不提供滚动条，`clip` 则连程序滚动也禁止。因此本次采用 `overflow:hidden` 的视口，通过选中项显露、横向滚轮和标签菜单移动视口，不使用 `clip`。来源：[MDN overflow-x](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow-x)。

渐变可作为 `mask-image`，其透明度控制被遮罩元素的可见度。把遮罩仅应用于标题文字，可保留图标、类型后缀和关闭按钮的清晰度，并随任意主体色自然衔接。来源：[MDN mask-image](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-image)。

标签键盘交互采用左右键移动焦点、Home/End 定位首末项、Enter/空格激活。方向键只移动焦点，避免浏览业务面板时意外切换。来源：[W3C Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)。

| 方案 | 优点 | 代价与结论 |
| --- | --- | --- |
| 隐藏原生滚动条，只保留滚轮 | 改动小 | 鼠标用户不易发现屏幕外标签，不能独立作为最终方案 |
| 多行换行 | 所有标签可见 | 标题栏高度随数量变化，破坏桌面布局，本次不采用 |
| 全部压缩到很窄 | 行高稳定 | 长标题、类型和关闭入口难以辨认，本次不采用 |
| 单行视口加所有标签菜单 | 保留整洁标签条和稳定高度，所有标签可达 | 增加一个仅溢出时出现的入口，本次采用 |

## 改动边界

鼠标排序的 HTML 示意使用 Pointer Events。`setPointerCapture` 将后续同一指针事件路由到捕获元素，允许拖动离开源标签后继续追踪；指针取消须结束交互并清理状态。来源：[MDN setPointerCapture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)、[MDN pointercancel](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event)。本次用左键与移动阈值区分点击和拖动，并仅在视口内落下时提交顺序，避免拖动误触发正文切换。

第四版根据用户附图采用玄墨亮灰选中底色与中性细描边；玄墨不再要求选中底色与正文相同，宣纸继续同色。附图只提供视觉参考，不复制图中标题。拖拽按鼠标按下点保留二维偏移：预览左上角为 `clientX - offsetX`、`clientY - offsetY`，不把预览固定在标签条下方，也不把预览横向夹在视口内。预览离开标签条仍跟随鼠标，落点是否合法单独判断。

真实 `src/stores/tabs.ts:201–234` 目前没有重排方法；`:257–283` 的打开、关闭和激活使用场景离开 guard。排序只改变数组顺序，不离开选中场景，因此批准后需要独立的重排动作，保持选中 id 与其余状态，不复用打开/关闭操作来模拟排序。`ContentTabs.tsx:204–216` 的 key/hidden 业务结构在排序时保持。

正式实现沿用 `ContentTabs.tsx`、Tabs store、内容 registry、封面缓存、暂定标记、类型后缀、关闭和面板操作。只调整标签条结构、局部样式及溢出与焦点逻辑。保留原生菜单、窗控安全区、44 DIP 标题栏和既有面板控制的位置。

新增 HTML 仅为本次审核媒介。既有 `design/desktop-preview.*` 不作为运行来源。不会向源码、日志或证据写入真实作品、用户数据或 Key。

## 本轮交付顺序

调研 → 产品设计及技术落点独立审核 → HTML 设计稿由用户审核 → 专项用例及独立审核 → TDD 实现及独立 code review → Tabs 专项测试和可执行的真实 Windows 检查 → 总结。当前只提交设计阶段；产品实现、测试通过及原生验收结论均在后续阶段产生。
