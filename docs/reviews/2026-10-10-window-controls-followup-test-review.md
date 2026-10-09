# 窗控重叠与悬停反馈测试清单独立审核

日期：2026-10-10。阶段：测试用例审核。最终结论：**复审通过，可进入 TDD 红灯及实现阶段。** 下方保留初审发现及补充后的复审依据。本轮只新增此审核记录，未修改实现或测试，未执行原生 UI 操作。

## 依据

已完整读取 `2026-10-10-window-controls-followup-test-cases.md`、补充后的 followup-plan 及其独立审核。只读比对 `tests/unit/window-appearance.test.ts`、`root-maintenance-window-review.test.ts`、`root-relocation-window.test.ts`，以及三个既有 browser 回归的真实来源提取方式。读取 `docs/evidence/window-controls-followup/native-baseline.json`，查看同目录 `native-baseline.png` 与 `native-baseline-max-hover.png`；此为查看已有本地证据，没有发起或恢复原生输入。

原生基线记录未打包的 Electron 44.6.0、win32、paper、revision=1、zoom 对应 viewport 宽 1440，原生有效暗色为 true/source=system。caption 可用矩形 right=1303、y=0..44；恢复内容按钮 x=1400..1428、y≈7.67..35.67，进入右侧原生保留区；菜单 x=1269..1297、y=7..35，在其左侧。正常截图与此重叠一致。只证明该基线状态，不表示修复、全字号/缩放、hover 对照或安装包通过。

## 初审需补充

1. **WCO-F02 明确延后事件与最终广播断言。** 当前只显式列 source setter 同步触发 updated。方案独立审核还要求 setter 延后触发的回放，验证 queued updated 使用当时已提交主题，不把旧 choice/dark 写回，不重复赋 source；paper→system/深色系统与 ink→system/浅色系统均断言实际发出的 theme.dark。同源无赋值时不能靠虚构事件保证 renderer 得到新有效值。测试保持注入真实 helper 和实际 main 回调，不能仅断言 mock 函数入参。

2. **WCO-F03 明确维修/重定位新增 source 接入断言。** 既有维护 rig 的 nativeTheme 只有固定 `shouldUseDarkColors:true`，重定位 rig 只有固定 false；断言保存主题的 background 或复跑这些旧用例，不会证明新的 themeSource 被设置，更不能证明其先于 constructor。新增受控案例需执行实际 cold 模块，观测 source guard/赋值顺序及窗口选项、runner/controller/body 有效主题快照的一致性。保持原内存 session、未触碰源 session、无工作台服务/模型 vault 的既有断言，不修改无关业务或削弱断言。

## 已满足与实施边界

- TDD 顺序正确，要求旧代码实质红灯、实现后绿灯及独立 code review；解析/缺依赖错误明确不能作为产品红灯。修正 harness 后应保存有意义的重新红灯，不能直接开始实现后补称旧代码失败。
- F01/F02/F03 使用 actual send/revision/apply/updated/构造前语句及真实 helper，包含两种返回 system 场景、同步重入、旧 revision、同 revision 重开和空/销毁窗口。F04 保留透明 overlay、44px、真实 CSS palette及无 Electron import。通过时须保持这些来源约束，不能替换成独立复制的同步算法。
- S01/S02 的物理宽度→CSS viewport、五档 zoom、三档字号和侧栏显隐矩阵合理。env 注入属于受控 CSS 几何，只替代外部 env 值，不得改安全区表达式或用期望算法代替实际 CSS。二维交集、菜单本身与 caption 的关系及恢复按钮未裁出窗口、可点击需要分别断言。
- 提取真实 ChatPanel header 可隔离业务 I/O，但没有整个 DashboardShell 导航/Panel 包装，不能据此宣称已覆盖 899/679 响应式真实 y。该部分由 N02 的完整原生工作台观测承担，或增加实际来源包装夹具。应包含有消息时标题/图标的宽度占用，保留原 flex 压缩与事件。
- S03 保留 Web/macOS 右布局、左侧 traffic lights、点击/键盘恢复及内容展开后的间距释放，并复跑真实来源的既有拖拽与空态测试，范围合适。
- N01/N02/N03 覆盖真实 paper/ink/system、恢复内容、空/有 Tab、窗口宽度与 zoom、原生窗控和隔离重启。原生专项建议显式记非活动窗口 hover 及应用菜单/原生对话框的主题副作用；未执行的组合保持未执行，不从主动窗口单张截图推断。
- 本轮系统对照允许 Electron source 受控切换，但不修改 OS 主题、也不宣称真实 OS 设置变化。renderer CDP offline 的范围说明正确；本地协议和资源探针不等于 OS 全断网或安装包原生启动。新版解包应用必须实际使用新产物，并记录来源/版本/路径与 hash。
- 全量活动 unit/integration/browser 不排除已知失败；并发、每文件超时及失败/cancelled/skipped 原样保留；W03/W04 正式仍 planned。原生只用 computer-use，物理 Escape 再中止即停止输入并保留未执行。这些边界符合 AGENTS。

本次未运行新增测试。初审曾要求清单明确上述两项，补充后的结论如下。

## 补充清单复审

再次完整读取已保存的 `2026-10-10-window-controls-followup-test-cases.md`，核实以下内容已进入清单正文：

- F02 新增真实 callback 队列回放、paper→ink 后早期 updated 仍应用当前选择、最终广播 dark 与当前 source 一致；结合 F01 的两种返回 system 场景，覆盖同步与延后事件路径。
- F03 明确实际维修/重定位模块受控 port 的 source getter/setter、constructor 当次 source，以及 source 在 constructor 前且与 body 有效快照一致；显式 paper 对暗系统、ink 快照和原数据安全/生命周期断言均保留。仅复跑旧 fixture 明确不算新增同步验证。
- S01 明确 header 提取结果仅为受控几何，不冒充 DashboardShell 的响应式包装；真实 y 由 N02 承担。N01 补充非活动符号可读和原生菜单副作用。

因此初审两项覆盖缺口已解决，**测试清单通过**。后续 code review 仍需检查这些用例确实执行真实来源并断言顺序/输出，而非只存在用例名称。新 source 受控诊断、原生基线和 TDD 红灯/绿灯继续分别记录；本复审未独立查看未列入本轮依据的新 hover 对照，也不宣称它已原生验收通过。
