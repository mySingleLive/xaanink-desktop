# 空右侧收起图标尺寸统一

2026-10-09（Asia/Shanghai）。用户确认将新加空内容面板顶部右侧的图标改为左侧导航栏收起图标的同一尺寸。

仅把 `ContentTabs.tsx` 零Tab按钮中的PanelRight `size-3.5` 改为 `size-4`：默认root rem=16px时由14px变16px，与真实 `SidebarWindowControls` 的PanelLeft一致，并随UI字号/zoom同比例变化。按钮点击区域、工具条位置、Windows padding及回调保持。其它既有工具栏图标不属于本次新按钮尺寸修正。

按AGENTS顺序独立方案审核 → 用例及独立审核 → RED → 一处class实现与独立code review → 全量活动自动测试/类型/两侧构建/真实macOS验证。用例在已有empty-content-hide browser fixture加入真实SidebarWindowControls，只测真实SVG几何，断言左右图标等宽高、值等于root rem；沿用字号/zoom/Windows占区矩阵及收起/恢复回归。真实Electron harness同步比较当前工作台左右图标几何；沿用先前修正后的独立runtime及各次证据目录，使用新implementation-48证据路径以保留历史记录。Windows原生目标机及安装包本轮仍未执行。

已有未提交修改全部保留，仅登记本次有限development；不改变完整业务/跨平台验收状态。CodeGraph仍无可调用工具，本机此前未找到命令，复用已打开的具体源码。
