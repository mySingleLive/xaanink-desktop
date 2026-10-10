# 工作区技术方案独立审核

2026-10-10。独立子代理只读检查方案及源文件，主代理记录返回意见。最终结论：通过，可以进入测试用例审核与 TDD。此结论不是实现或产品验收。

初审发现 MarkdownEditor.tsx 原 split 布局中列固定 1px（约第348行）且 div 为实色 bg-border（约第380行），会在 DPR1.5 与普通边框产生细度差。必修建议是同时使用边框占位和 auto 中列，否则仅改边框仍留下余宽。主代理已补入方案第4条及 SURF-02；独立复审确认左右 minmax 防挤压、实例生命周期保留，必修项关闭。

其余方案核对通过：左右 ResizeHandle 统一而复用原库10/20px不可见命中扩展；宣纸 token 局部于三个 workspace，规划保留原背景 fallback；右 Monaco/gutter 局部变量不改变全局或 AI 编辑器；通用 Separator/menu/hr 等结构线统一边框；caption 底边与上padding同为1px，保留44 DIP行高、窗控安全区和原 Tab选中标记的zoom补偿。

依据：[方案](2026-10-10-workspace-surfaces-plan.md)、DashboardShell、desktop.css、MarkdownEditor、planning.module.css、安装的分栏库源码。对应交互和缩放效果仍需后续测试，不从源码判断直接记为通过。
