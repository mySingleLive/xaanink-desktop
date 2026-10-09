# 空右侧收起图标尺寸统一用例独立审核

2026-10-09（Asia/Shanghai）。只读审核159用例及现有浏览器fixture/原生harness，参考157/158范围；未执行测试、启动UI或修改实现。现有源码仍是上轮用例和implementation-47默认harness，本结论审核的是159明确提出的扩展设计，不将计划中的断言描述为已经运行。

结论：**通过，可进入实际几何RED及最小实现阶段。** SIZE-01–04覆盖左右图标同尺寸和原有按钮合同，没有用例设计阻塞项。

- 将真实SidebarWindowControls放在fixture的restore/content/menu之后，可保留EMPTY-02从刚点击的恢复按钮按Tab到右侧产品按钮的顺序；fixture应挂载真实左侧控件，不能只导入一个PanelLeft当作左导航。左右SVG均从明确的收起button读取，避免使用页面首个SVG或错取后退/前进图标。
- 扩展既有contained，使每次空态几何检查同时验证左右SVG宽高相等且各自等于当前root rem，覆盖默认16px、字号边界和实时zoom/font更新；现状14px/16px应在实际SVG尺寸断言处产生RED，不能用缺失组件或环境失败替代。保留现有面板内定位、drag/no-drag、菜单及窗控间隔断言。
- SIZE-02明确默认24px点击区保持，建议几何采样同时记录button width/height，断言二者为1.5×当前root rem，且SVG完全位于button内。这样可直接验证本轮只改图形尺寸、没有缩小或移动原点击区；不是class字符串镜像断言。
- 原生SIZE-03在完整真实工作台比较两处收起SVG，沿用原生zoom读数、几何稳定等待、CUA系统点击、键盘、重启AI恢复和最后Tab流程，能够证明产品实际呈现，而非仅fixture一致。新证据路径必须使用implementation-48及各运行独立子目录；旧47默认harness/报告不应被本轮覆盖。左右图标尺寸、root rem和截图应记录到本轮JSON供最终复查。
- SIZE-04明确先完成构建，再运行依赖生成物的完整browser，避免重现上一轮并行.next读取失败。完整core/browser、typecheck、两側构建和diff检查合并验收范围清楚；聚焦重复用例和native检查不重复计入自动用例总数。
- Windowsfallback/env布局矩阵仍属于浏览器合同。未执行Windows原生目标机、DPI和更新安装包时保持未执行，有限development记录不应提升W05或完整业务迁移状态。

以上为用例设计审核；具体测试扩展及真实运行证据留待后续code review/最终复查。
