# 三栏顶部窗口拖动：独立验证与夹具修复审核

2026-10-09（Asia/Shanghai）。审核 `scripts/smoke-pane-window-drag.mjs`、`139-pane-drag-browser-harness-repair.md` 所列 9 个 browser 文件 diff、回归日志及当前原生证据。仅写本记录，未修改生产或测试文件，未自行操作原生 UI。

结论：**9 文件夹具修复和当前完整开发测试结果审核通过；原生最终报告仍需完成下述通过门后复查。**

## 浏览器夹具与回归

- catalog 两处计数改为当前实际生成的 darwin 417 / win32 401；独立读取 shipped JSON 确认为 Monaco 0.56.0 和该计数。完整 assembled/shipped/trusted 字段相等及破坏输入拒绝断言保留。
- 两处 CSS 读取由旧固定哈希文件改为当前全部 CSS chunks 的排序拼接；原 UI/命令/焦点断言保留。
- 三个恢复预览相关文件只移除已无生产消费者的假 workBackup 桥，并更新准确文案定位。独立核对真实 RecoveryDialog 对应列表、导出、作品草稿与空态文案；原原稿/隐藏元数据/复制/完整导出/失败保持断言保留。
- file-export fixture 改为真实 service.export() 的 `xaanink-local-templates` 输出；实际 shared schema 仍允许旧品牌输入。该改动未削弱已有文件内容与正文格式解析断言。
- 两个 lease 文件将不存在的 WorkBackupsPanel 相关部分按已批准备份退役范围拆分，活动测试直接使用真实 WorkLeasePendingDialog/DesktopApp，保留单飞、屏障、异常、卸载晚回执等要求，Proxy 拒绝备份桥读取。late ordinary state 测试确实发送高 revision 状态并验证接纳后仍保留屏障，而非用空状态绕开原要求。
- 独立用 Git HEAD 原件与两个 `tests/retired/backups/mixed-originals/tests/browser/work-lease-ui*.test.ts` 比较，字节完全相等。SHA-256 分别为 `04903863b64caca383f599ffbc713ca906705337948bf8348905d5ffbb28381a`、`3f35d9c8ea391278de14f2d0f4d3621d2ec64617ad7a8a60ac11bdf08cb443ae`，与 139 一致。退役 LUI23-03 保留历史，未计作 passed 或 skipped。

已独立读取 `/private/tmp/xaanink-drag-core.log` 与 `/private/tmp/xaanink-drag-browser-final.log` 的最终结果：core **1624/1624**、browser **176/176**，均 0 fail / cancelled / skipped。该结果是当前活动开发测试通过，不替代整应用正式 530 项业务与平台验收。

## 原生观察脚本和证据边界

脚本限定显式 `/private/tmp/xaanink-pane-drag-*` 隔离根；启动实际离线 workbench，验证 `xaanink://app/`、指定 dataRoot 和默认无模型；读取真实 BrowserWindow bounds/maximized/fullscreen、当前元素 CSS/geometry，并保存源码 hashes 和截图。脚本不调用 maximize()/setBounds() 伪造鼠标结果。`node --check scripts/smoke-pane-window-drag.mjs`、`git diff --check` 均 exit 0。

原生双击与移动须保留各自输入来源：双击是 CUA 系统鼠标，拖动在 driver 对既有 SidebarWindowControls 也无法移动的条件下采用人真实鼠标，并以聊天明确确认和只读 bounds 观察补证。失败的 CUA drag 不能计为通过；人操作不能标成自动化执行。

中间证据 `native-intermediate-baseline-error.json` 已保留 status=failed，实际窗口移动为 `(784,320,1440,940)` → `(897,352,1440,940)`；错误来自复原断言引用旧正常位置。此记录可以证明确有位置变化和正确拒绝旧 baseline，不能因已解释原因而改为 passed，也不能替代三处最终完整双击/复原记录。

本次发现并即时报告的原生通过门：

1. finish 不能只凭 `*-maximized` / `*-restored` label 存在。应验证每个记录对应 kind=maximize/restore、同一实际正常 baseline、maximize 真、restore 假且 bounds 复原、都非 fullscreen，且顺序完整。baseline 不能本来就处于最大化。
2. AI 与 Tab 导轨的人拖动确认不能推断右无 Tab 顶部也通过。需完整三处的明确人确认；当前只获前两处时不可 finish。
3. 既然 CUA drag 对已有 sidebar 也无效，CUA drag 后 Tab/按钮窗口不移动没有判别力，不能独立记为原生拖动排除通过。可用有效的 CUA double-click 证明 Tab/按钮/正文不最大化，并精确标成双击排除；拖动排除要用人真实鼠标或其他已证实有效的输入。
4. 原生 status=passed 须来自最终完整记录。Windows、最终安装包和全量正式业务验收未执行的部分保持未执行；macOS development Electron 证据不得扩写成跨平台安装包通过。

审核时最终原生 JSON 仍为中间失败版本；最终通过状态、三处确认、实际正常 baseline 和排除观察尚待主代理完成后复查。

## 最终原生复查

最终 `docs/evidence/implementation-44/pane-window-drag-native.json` 已为 status=passed、errors=[]。独立读取全部观察记录与当前脚本，并实际执行 `node scripts/smoke-pane-window-drag.mjs --verify-report docs/evidence/implementation-44/pane-window-drag-native.json`，exit 0；三份生产源码 SHA-256 与本轮原生证据一致。

`validateNativeChecks` 已补齐此前 gate：三处 baseline/maximize/restore label 各唯一、kind 正确，baseline 是正常非全屏窗口，maximize/restore 引用同一 baseline，观察顺序正确，最大化状态为真、复原状态为假，且全程非 fullscreen；复原 bounds 与各自实际正常 baseline 全等。AI 与 right-rail 最终均复原 `(784,320,1440,940)`；right-empty 以人移动后的 `(887,326,1440,940)` 为正常 baseline，最大化后准确回到该位置。新增 verifier 对最终报告补验，不把运行中旧 gate 的存在当作已具备该检查。

右无 Tab 的 `right-empty-human-before` → `right-empty-human-dragged` 观察确认为 `(784,320,1440,940)` → `(887,326,1440,940)`，大小不变，顶端 region=drag，且不存在 Tab 导轨。主代理传入的本轮直接用户确认是右无 Tab“可以移动”，此前 AI/rail 的直接确认是“两处都能移动”；最终 dragVerification 明确列出三处且来源为人真实鼠标。AI/rail 的早先真实位置变化仍保留在 failed 的中间 baseline 错误记录中，没有篡改或据此标自动化拖动通过。

Tab、pane button、composer 三项最终排除记录均引用正常窗口观察，kind=no-drag、位置在 baseline 之后，实际完整 window 状态与 baseline 相同。这些操作是已能触发顶部最大化的 CUA double-click，证据只证明该处双击不切换窗口；不声明人/有效自动化的物理拖动排除通过。此前 CUA drag 对原 sidebar 无法移动的尝试继续排除在通过计数之外。

独立查看最终 `ai-restored.png` 与 `right-empty-restored.png`：真实工作台保留正文/composer/业务组件；有作品状态下工作流行可见且位于 AI 顶部空白标题之后，右无 Tab 的顶部空白区与两侧标题顶部对齐，原右空态仍保留。

结论更新：**本轮最小产品变更、夹具修复、当前活动开发测试及上述 macOS development Electron 的三处拖动/双击验收审核通过。** Windows、最终安装包、物理拖动排除和整应用正式 530 项验收未被本记录扩写为通过。138 与需求/迁移台账尚由主代理落盘，最终文字需继续保持上述精确范围。

## 最终文档与台账复查

已读取最终 `138-pane-window-drag-verification.md`，其准确区分 1800 项活动开发测试、类型/构建、macOS development Electron、人工三处拖动、有效 CUA 双击与交互排除，并明确物理拖动 Tab/按钮的排除、Windows、安装包、吸附、多屏/DPI 和完整正式业务验收未执行。原 39px Tab 导轨保持原排版，三处顶部 y=0 的陈述与最终几何记录一致。

已检查 `docs/evidence/implementation-44/verify-native-gate.py` 及 `native-gate-validation.log`：程序先验证未修改的最终有效报告，随后在临时目录构造 12 种无效报告，命令结果逐项 rejected；未修改最终 JSON。当前 verifier 还要求 errors=[] 和 sourceHashes 恰含三份生产文件，空 hashes 无法绕过。再次独立执行最终报告 `--verify-report`，exit 0。复制到 evidence 的 core/browser-final 日志最终计数与保留的临时日志一致，类型/构建原日志已读取。

独立解析 Git HEAD 与当前需求/迁移 JSON 作深度比较：`migration-map.json` 移除唯一新增的根部 `desktopTopRegionAdaptation` 后，与 HEAD 完全相等；没有改变任何原业务迁移条目。`requirements-traceability.json` 的 W04 总 status 仍为 planned、总 evidence 仍为空，只增加本次有限 development 证据并补齐当前实现/测试路径；全部其他 requirement 条目与 HEAD 完全相等。新增 note 明确保留上述未执行范围。最终 `git diff --check` exit 0。

**最终复查通过，无剩余本轮审核发现。** 本次批准范围以 138 的有限开发与 macOS 原生证据为准，不授予原清单整体或未执行平台/分支通过状态。
