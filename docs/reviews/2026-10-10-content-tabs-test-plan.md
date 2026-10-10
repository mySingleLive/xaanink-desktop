# ContentTabs 专项测试用例

设计 `ink-xy-v4` 已于 2026-10-10 获用户批准。此清单接受独立审核后先写失败用例再实现。范围仅 TABS-01 至 TABS-12，不跑全量测试或全量回归。

| 范围 | 必须执行的行为用例 | 证据层 |
| --- | --- | --- |
| TABS-01/02/03 | 空、1、3、20项；overflow:hidden，视口无横纵滚动条；44/32 DIP、上下6 DIP、6 DIP圆角、连续底线、默认光标及无红边；宣纸同主体，玄墨亮灰高亮 | 真实组件浏览器，Windows Electron |
| TABS-04/05 | 中英长标题/类型/暂定标记；宽不超208 DIP，真实溢出才渐隐，短标题不渐隐，关闭入口可达；缩放.75/1/1.25/1.5/2和字号11/14/24；常规/窄/极窄视口、数据重命名、字体和分栏变化、菜单最后项显露 | 浏览器几何 |
| TABS-06/07 | 点击/中键/关闭；左右/Home/End仅焦点、Enter/空格激活；横向滚轮、聚焦和激活显露只改标签视口scrollLeft，工作台外层不滚；菜单radio选中后收起、独立关闭保留菜单、方向键与Escape返回；原生safe padding和全屏/隐藏位置不变，视口0时菜单可达；空态隐藏/恢复 | 浏览器，直接相关既有测试，Electron |
| TABS-08/10 | 重排选中和未选中项、主体/输入/DOM实例保留；store原对象及active/nonce/subTabs/focus保持，不调用guard；按新序关闭邻项、菜单同步 | store单元 + 真实组件浏览器 |
| TABS-10/11 | 点击阈值及普通点击；非中心抓取、X/Y上下斜移与视口外跟随、回到条内提交；左右/首尾重排；窄条边缘横移到屏幕外项；外部落下取消 | 真实组件浏览器，Electron合成鼠标 |
| TABS-11/12 | Escape/cancel/lostcapture/blur/尺寸变化/外部删除/卸载取消和清理；关闭按钮不拖动，后续普通点击正常；Alt方向排序、边界/无效id/index不变、焦点/位置播报；NaN/Infinity/非整数index不变、有限超范围整数裁切首尾；标签no-drag而栏空隙drag；真实 Controller 捕获阶段不抢占聚焦标签 Alt排序和拖动中的纯 Escape，按钮/正文仍走全局导航，无拖动时原全局 Escape 有效 | 浏览器/store，Electron窗口位置 |
| TABS-09 | 完整 Windows Electron 使用隔离测试数据，正常/窄窗口、宣纸/玄墨、zoom、真实窗控和组件；重排/关闭/渐隐/菜单及输入实例保持，记录截图与源hash | Windows Electron；注明Playwright/CDP合成输入，不代替物理OS操作 |

测试文件：新增 `tests/unit/content-tabs-reorder.test.ts` 与 `tests/browser/content-tabs.test.ts`，必要共享夹具限定 `tests/helpers/content-tabs-fixture.ts`。直接相关既有用例为 `tests/unit/navigation-tabs.test.ts`、`tests/unit/desktop-command-controller.test.ts`、`tests/browser/empty-content-hide.test.ts`、`tests/browser/caption-alignment.test.ts` 的标题栏/键盘捕获范围；旧断言若与本次批准样式冲突，仅更新对应Tabs断言，不删除行为验证。新增 `scripts/verify-content-tabs.mjs` 和 `docs/evidence/content-tabs/` 保存专项输出/目标证据。

失败用例证据要来自旧组件/无moveTab的实际结果；通过证据要来自最终源码。测试报告区分组件夹具、真实Electron、受控DOM取消事件和未执行的平台。子代理code review发现问题后补足针对用例，再运行受影响专项，不扩大为全量。
