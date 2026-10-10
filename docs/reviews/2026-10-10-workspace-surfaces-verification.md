# 宣纸工作区验证记录

2026-10-10。批准第三版的四个产品文件已经实现并通过独立代码审核。当前结论：**本次UI专项通过，完整回归尚未全部通过，不能作完成验收总结。**

## 已通过检查

| 检查 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 专项及既有caption回归 | 12 tests / 12 pass / 0 fail、cancelled、skipped | `docs/evidence/workspace-surfaces/green-scene-final.json`及`.log` |
| 完整TypeScript | exit0，最终夹具/脚本版本 | `typecheck-all-final.json`及`.log` |
| foundation TypeScript | exit0 | `foundation-final.json`及`.log` |
| Next界面构建 | exit0，包含Scene/hr最终修正 | `build-ui-corrected.json`及`.log` |
| 桌面构建 | exit0，命令目录来源指纹刷新后 | `desktop-catalog-corrected.json`及`.log` |
| Windows真实工作台 | 最终重建39检查点，0pageerrors，Electron44.6.0 / Node24.21.0 / win32 | `native-local-08/windows-electron.json`、六张PNG |
| 既有平台夹具修复 | 三文件全部原用例24/24，0跳过 | `browser-fixtures-corrected.json`及`.log` |
| 最终目录同步/导出/lease/重定位 | 15文件146 tests / 146 pass / 0 fail、cancelled、skipped，原断言及Win真实ACL | `directory-final-affected-acl.log` |
| 冻结后原浏览器导出 | 7/7，0失败、取消或跳过 | `browser-export-sealed-final.json`及`.log` |
| 最终TypeScript / foundation / desktop build | 均exit0 | `typecheck-acl-fixture-final.json`、`foundation-acl-fixture-final.json`、`desktop-directory-sealed-final.json` |

以上路径均相对于 `docs/evidence/workspace-surfaces/`。12项不是“12项新增业务”：其中7项分栏专项、5项caption回归，15组代表DPR×CSS zoom组合嵌入专项测试。三文件夹具24项与完整browser有重叠，不叠加声称独立测试数量。

## 实际Windows证据

从新隔离根启动 `xaanink://app/`，模型数为0、renderer离线。应用本身无HTTP监听，脚本未注入设计CSS或替换DOM。关闭首次空态后，真实服务/Prisma/DraftJournal创建隔离合成作品与会话，重新启动后打开真实原面板。合成资料没有写入源码或作者目录。

固定颜色期望：左 `rgb(245,238,220)`、AI `rgb(250,246,232)`、右 `rgb(248,243,228)`，结构线 `rgb(216,203,166)`。真实规划、SceneWorkspace、试验场、候选稿、正文正文/gutter和preview分别检查；AI真实内嵌编辑器仍为原 `rgb(249,244,228)`，AI任务表面为 `rgb(252,248,238)`。

实际系统DPR基线1.5。原生zoom .75/1/1.25/1.5/2 × UI字号11/24共10组，字号14为基线；记录实际DPR、字体、面板矩形、横竖线宽、44 DIP头部、16 DIP按钮中心、尺寸与原生安全区。线条零内容宽、透明底、无内嵌线且面板直接邻接；按同页面横线实际取整宽度比较。

正文真实Monaco编辑器同一DOM实例：输入草稿、选择末行、纸→墨→纸往返后，替换仍选中的末行并两次undo还原原稿，证明模型选区与撤销保持；未以textarea代理selectionStart冒充模型选区。CDP `imeSetComposition/insertText`验证合成Chromium组合输入与undo，**未执行物理Windows中文输入法，也没有macOS正式验收结论**。

实际分屏中线仅边框占位、两侧无gap、两列非零；真实Markdown hr和菜单分隔同等细度。两条线旁约3px范围鼠标拖拽和键盘箭头实际改变尺寸。显隐、全屏、窄窗入口、主题持久化和关闭重开分别验证。

全屏实际残宽 `0.46875 CSSpx × DPR1.5 = 0.703125设备px`，小于1设备像素。按独立审核采用设备像素容差，并校验全屏ARIA及0条分隔；隐藏导航时校验1条剩余分隔、重新显示入口。记录真实残宽，不声称精确为0，也未证明修改前同场景已存在。最终六张原始截图未见宽亮槽；全屏显隐依据上述几何、ARIA和分隔检查，六张最终截图没有全屏态。

前六次原生运行各保留独立目录：前置脚本CommonJS格式问题、CSS module定位问题、过严折叠宽度断言均可追溯；没有覆盖失败记录或跳过检查。最终四个产品SHA与代码审核绑定，源码、dist及静态资源SHA保存于native JSON；未声明新安装包已生成。

![真实Windows正文分屏与宣纸三栏](D:/Projects/xaanink-desktop/docs/evidence/workspace-surfaces/native-local-08/implemented-manuscript-split.png)

## 完整回归与未通过项

首轮完整browser `browser-final`：219 tests / 195 pass / 24 fail / 0 cancelled、skipped。独立定位18项lease在Windows路径夹具打包阶段缺export，2项API Key在Windows Chrome使用Darwin原生撤销键，4项导出保存确认真实失败。

两个lease夹具仅将importer分隔符规范化，API Key保留Darwin命令路由夹具、纯浏览器native undo/redo按宿主OS处理；原行为期望未削弱，24项原用例重跑全部通过。修正后完整browser `browser-fixtures-final`：219 tests / 214 pass / 5 fail / 0 cancelled、skipped。4项导出仍失败，另1项MUI73-10在页面截图阶段触发原1600ms时限；`maintenance-screenshot-retry`准确名称原样重跑1/1通过，两主题原行为断言和截图通过，源码前后SHA一致，原时限未改变。支持偶发截图时限判断，不覆盖完整suite的5项失败，也不证明全量已稳定通过。平台夹具不证明macOS原生通过。

4项真实Windows导出失败保留。主进程已写入、fsync文件并rename后，目录fsync返回EPERM；原服务拒绝ACK，返回 `EXPORT_DURABILITY_UNCONFIRMED`。不能吞掉所有permission异常或以文件存在代替保存成功。它不是本次CSS造成，也不是纯夹具通过项；未进行HEAD同场景完整复验，不能声称所有全量失败已与基线逐项对照。

`core-final` 向全部246文件发起运行，concurrency2、30分钟后仍有未完成文件，exitCode null、没有最终TAP totals，最多到编号841的前缀，**不得将前缀当完整测试统计**。日志包含真实Windows审核落盘确认失败、worker失败和超时。`core-hang-probe`对inbox用例设20秒显式超时，4项中2 pass、1 fail、1 cancelled：W02长期等待，W03锁仍存在。

`core-bounded-final` 向全部246文件运行，concurrency4、显式60秒默认timeout，最终runner汇总为1741 tests / 1605 pass / 123 fail / 11 cancelled / 2 skipped，exit1。最后一个 `work-lease-handoff.test.ts` worker仍未正常退出；经独立审核后重新校验精确PID343700、父PID341804、创建时间及完整命令，只终止该本轮隔离worker，运行器随后输出上述汇总。身份、原因与UTC时间保存在 `core-worker-termination.json`。这是**含人工终止的runner汇总**，不能称全部246文件正常完成、无干预完成或全量通过。失败、取消、跳过均保留，未吞掉目录fsync/EPERM错误。

## 后续修复与最终有限范围结果

以上首轮失败全部保留。目录同步兼容性经独立技术/测试/代码审核后实现：仅Windows、真实只读目录句柄identity验证后、sync EPERM且syscall为fsync可按既有unsupported能力契约继续；文件fsync、其它phase权限失败、IO失败、关闭失败及所有授权/seal仍强制成功。它不是Windows目录元数据已耐久落盘的证明。另关闭独立审查复现的临时清理竞争，原异步观察之后同步验证父canonical及叶完整revision，紧邻unlinkSync；新增外来置换回归及原EX16-09均通过。

新Win权限夹具只修改新建隔离root的当前SID创建文件/子目录ACL：先验证绝对路径、tmpdir和固定前缀；用execFile参数数组、windowsHide；真实wx探针EPERM；finally撤销deny再清理。Unix chmod0500保持，原失败/EXPORT_WRITE_FAILED/旧文keep/无残留断言保持。`windows-acl-probe.log`实测恢复与删除，原EX16-15在最终146项中通过。

冻结后15个相关unit文件 `directory-final-affected-acl.log` **146/146**，其中新helper5、新FileExports5与原lease27的37项是子集，不重复加总。TypeScript/foundation最终exit0，桌面当前重建exit0。UI四个源码未变，已有Next界面构建与专项12/12仍绑定其相同SHA。

完整browser `browser-windows-directory-final` **219/219，0fail/cancel/skip，exit0**，四原导出正例和MUI73-10两主题截图在完整集通过。该套件启动后另修后端清理，故不声称为所有文件同时冻结的统一快照；影响的原browser导出7项在最终源码重新执行 **7/7**，原断言/时限保持。其余浏览器源码及UI四源码未变，不用局部复验覆盖历史失败记录。

最新完整core `core-windows-directory-final`向248文件发起，历史默认120秒、concurrency4，正常结束无需人工终止，实际 **1746tests / 1697pass / 44fail / 3cancel / 2skip，exit1**。运行开始后清理及unit夹具发生变更，该汇总是混合源码故障诊断，不能作为最终统一快照通过；不同注册/worker失败及取消也不能据文件数反推固定1741+新增数量。剩余包括历史冷源mode、头像文件链接、macOS原生检查、路径/加载夹具、PGlite期限等；必须逐项核实，不声称全部既有或无新增失败。此轮还出现esbuild spawn EPERM的IPC/profile/appearance失败，同源原3文件原断言准确重跑 **22/22**（`core-process-spawn-retry.log`），仅说明可复验通过，不覆盖原全量失败，也未证明具体进程限制原因。

最终实际Windows `native-local-08`从新隔离根重启当前dist，重复相同39点/6PNG，0pageerrors。13个sourceHashes与当前源码一致；原始bundleHashes共178，176条正式产品资源（5个dist入口及171个.next静态JS/CSS）均与当前匹配。另1条为仍保留的上一日测试产物 `dist/root-startup-test-6ec87fdc-7ab8-446f-980c-f9d940ed66f9/index.cjs`，当前匹配但不属于产品；1条为并发core产生后删除的临时测试产物。应用未引用这两条测试资源。原报告保留：当前匹配177条，其中正式产品176条，不伪称178条均为当前产品资源。验证包含原真实组件、几何、编辑模型/选区/undo、CDP组合输入、字号/zoom矩阵、显隐/主题持久化；不等于物理输入法、安装包、其它平台或全部业务验收。

目录修复审核：[方案审核](2026-10-10-workspace-surfaces-windows-plan-review.md)、[测试审核](2026-10-10-workspace-surfaces-windows-test-review.md)、[代码审核](2026-10-10-workspace-surfaces-windows-code-review.md)。非本轮问题：[全部来源调研](2026-10-10-workspace-surfaces-windows-failures-research.md)、[首轮逐项历史比较](2026-10-10-workspace-surfaces-regression-analysis.md)。用户已被询问完整回归是否扩大范围，未将等待偏好视作新授权、未恢复退役功能。

## 验收映射

SURF-01至06在上述有限UI范围内通过；SURF-07完整回归条件未满足。全量/物理输入法/多平台业务迁移状态不因本轮样式检查升级。最终台账与独立证据审核必须继续保留完整验收未通过，不输出“全部修改与全部测试已完成”的总结。
