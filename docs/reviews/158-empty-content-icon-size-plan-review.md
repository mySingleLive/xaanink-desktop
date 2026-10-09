# 空右侧收起图标尺寸统一方案独立审核

2026-10-09（Asia/Shanghai）。只读审核157方案、指定的真实ContentTabs/WindowControls、既有empty-content-hide浏览器测试和原生harness；未修改实现、执行测试或启动UI，上轮未提交修改保持。

结论：**通过，可进入用例及独立审核阶段。** 一处图标class调整足以满足左右收起图标同尺寸的要求，没有技术方案阻塞项。

- `ContentTabs.tsx` 零Tab分支目前使用`PanelRight className="size-3.5"`，其父button为`size-6`；真实`SidebarWindowControls`的“展开或收起左侧导航栏”按钮使用`PanelLeft className="size-4"`。只将前者改为size-4，默认root rem=16px时图标由14×14变为16×16，与左导航图标一致；左右均使用Lucide默认viewBox/stroke设置，随UI root字号与Electron zoom同比例变化。
- 新图标仍位于1.5rem按钮内，图标为1rem，四边保留0.25rem空间。按钮点击区、工具条h-11、Windows env/138/zoom padding、no-drag、focus样式和onToggleContent不需改变；Windows占区合同判断的是按钮外边界，此次只增大内部图形，不会扩大命中区或移动按钮。
- 仅零Tab的PanelRight属于用户指明的新增按钮。既有有Tab收起/全屏及Tab业务图标不在本次尺寸范围内；局部class改动与真实Web组件复用约束一致。
- 用例比较真实左右SVG的getBoundingClientRect宽高并与当前root rem相符，能发现现状14px/16px差异，比断言class文本更直接。需要在字号11/14/24及既有zoom/Windows矩阵中保留按钮几何和功能回归，RED应因图标尺寸不等失败，不能用运行环境失败替代。
- 在浏览器fixture加入真实SidebarWindowControls时，应保留真实按钮DOM和SVG；新增可聚焦左侧按钮可能改变EMPTY-02的Tab顺序。应合理安排fixture DOM或用实际Tab导航到达目标按钮，不以直接callback/脚本focus规避导航回归。左右SVG比较要用两处明确button的子SVG，避免把后退/前进或其他PanelRight图标当基准。
- 原生harness可在既有inspect中记录真实工作台左右收起图标宽高，沿用实际几何稳定等待、完整组件、独立runtime及按运行隔离的证据目录。使用新implementation-48路径保留implementation-47历史报告/截图；当前源码哈希及native报告须更新，不能沿用14px时的截图或结果证明16px。

该结论仅为本次尺寸调整方案审核。Windows原生/DPI及更新安装包本轮未执行时继续保留未执行边界，不提升W05或完整业务迁移验收状态。
