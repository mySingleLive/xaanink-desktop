# 宣纸工作区实现记录

2026-10-10。用户批准 UI v3 后，已完成技术方案及测试用例独立审核、旧代码 RED、产品实现和独立代码审核。完整验收尚未通过，本记录不声明全量通过。

## 产品变化

| 文件 | 结果 |
| --- | --- |
| `src/components/layout/DashboardShell.tsx` | 两条分栏均为单个零内容宽度的边框元素，删除第二条内嵌线；沿用原 Group、不可见命中扩展与键盘处理。 |
| `src/app/desktop.css` | 结构分割统一标准1px边框，宣纸线色沿用 `#d8cba6`；移除实色层和透明沟槽。局部左/AI/右背景分别 `#f5eedc/#faf6e8/#f8f3e4`，右与AI色差更小。SceneWorkspace、试验场、右Monaco正文与gutter接入右背景，AI编辑器保留原背景。 |
| `src/components/content/planning/planning.module.css` | 真实规划根背景优先读取右侧局部令牌，保留非桌面fallback及卡片层次。 |
| `src/components/editor/MarkdownEditor.tsx` | 给原编辑/预览分屏加语义class；中列auto按实际边框占位，左右minmax保留。未更改编辑器生命周期、key或稿件状态。 |

Windows44 DIP头部及16 DIP控件中心、安全区沿用原规则，仅使结构底边与平衡padding统一1px；选中Tab的标记保持原缩放补偿。字号和缩放下边框按浏览器实际取整，与同页面普通横线比较。

产品继续复用真实React组件；设计目录仅供审核。合成作品和会话只存在隔离测试目录。全局主题令牌及Monaco主题注册未被更改。

## TDD与审核

`red-before-implementation` 记录旧实现6项中5项实质失败，分栏交互原有项通过。独立审核另发现真实ScenePanel根覆盖父背景，`scene-before-fix`记录固定色值失败后修正。`green-scene-final`为12/12通过，其中7项本次专项、5项既有caption回归；没有跳过项。

[技术方案](2026-10-10-workspace-surfaces-plan.md)、[方案审核](2026-10-10-workspace-surfaces-plan-review.md)、[测试清单](2026-10-10-workspace-surfaces-test-cases.md)、[测试审核](2026-10-10-workspace-surfaces-test-review.md)、[独立代码审核](2026-10-10-workspace-surfaces-code-review.md)。审核绑定四个产品文件指纹，当前没有未关闭的产品必修项。

构建发现原命令目录来源指纹过期，按仓库既有生成脚本重建。`desktop/shared/command-catalogs.generated.json`仅9个来源SHA变化，命令内容、平台目录SHA和Monaco版本保持一致。最新桌面构建已通过。

## 验证状态

专项12/12、完整TypeScript、foundation TypeScript、Next界面构建、桌面构建已通过。最终重建后的 Windows 工作台39检查点通过。后续完整browser实际为219/219、0失败；冻结后导出browser原7项全部通过。目录同步、导出、lease与重定位相关原回归及新增用例146/146。最新核心runner实际1746项中1697通过、44失败、3取消、2跳过，正常退出1、无需人工终止；启动后发生清理/夹具修复，因此是混合源码诊断，不代表最终统一快照通过。最终结果、失败定位和平台边界见[验证记录](2026-10-10-workspace-surfaces-verification.md)；完整核心仍未满足全部测试通过，不能用本轮有限范围结果代替全部要求验收或输出完整完成总结。

## 阻塞回归的 Windows 修复

四个原导出正例因只读目录 fsync 的 Windows 能力限制失败。另按[独立技术方案](2026-10-10-workspace-surfaces-windows-plan.md)、[测试审核](2026-10-10-workspace-surfaces-windows-test-review.md)完成行为RED、共享helper与四调用接入，并通过[独立代码审核](2026-10-10-workspace-surfaces-windows-code-review.md)。`desktop/core/directory-sync.ts`先固定私有目录身份，追踪open/stat/sync/close，只有真实Windows策略、已验证目录句柄、sync的EPERM/fsync增加能力例外；其它权限、IO、身份及close失败继续拒绝。原后置授权/完整字节读取与seal全部保留。

普通文件flush失败后仅清理有完整原父/叶同步seal的自有临时文件。独立审核实际复现的异步lstat后外来置换已新增RED与回归关闭，外来文件不删。原EX16-15 Windows夹具在新隔离root用真实ACL拒绝创建文件并恢复权限，保留原失败/旧文/无残留断言；Unix chmod分支保持。已取消备份功能未恢复，冷源/头像/macOS等其它问题仅记录在[失败来源调研](2026-10-10-workspace-surfaces-windows-failures-research.md)。
