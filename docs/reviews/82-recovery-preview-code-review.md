# 82 · 恢复草稿可读预览与隔离原因独立代码审核

结论：**限定通过**。本轮发现三类 P2 展示缺陷，均由作者修复，原数据与独立行为断言未被删改以规避失败。审核者独立执行相关 46 项 Node、10 项实际 React/BaseUI/Chromium 检查，合计 **56/56**，无跳过或取消；全项目 `tsc --noEmit --pretty false` 退出 0、空诊断。v2 冻结 32 项 SHA 与聚合指纹全部匹配。

## 范围与独立性

受审冻结：`docs/evidence/implementation-18/recovery-preview-frozen.json`，v2 聚合 `2aa8dc0f7eafe3896302063fc9855c80b4979086d3a62dde826a128c5eab9997`。算法按 `sources/tests/independentTests/dependencies/evidence` 顺序连接 `path:sha256`，每项包括末尾 LF。v1 原聚合 `606d402a0269cea6e4d578a6ddcb41c94f2f2dc8f9291bc553c065b86de48000` 与初审证据保留。

本轮生产范围为 `recovery-preview.ts`、`draft-recovery.ts` 的新原因及投影关系、`RecoveryDialog.tsx` 和 `DesktopApp.tsx` 的恢复原因接线。审核者曾参与更早的恢复基础实现，本报告只审核本轮作者新增的投影/原因变更及相关回归，不自行重批 50/54/78/81 的基础实现。审核期间未修改生产源或作者测试，仅新增两份独立测试与审核证据。三项发现均在作者修复前实跑留存 RED。

## 发现与修复

| 发现 | 严重度 | 实际触发和影响 | 复审结果 |
| --- | --- | --- | --- |
| REC82-01：已知作者正文投影不完整 | P2 | 原 SettingPanel 的 `content:{text}`、原 CharacterForm 的性格/外观/小传/说话风格未映射。记录有名称时被标为可读、可复制，实际只显示和复制名称。RP82-01/02 及实际 React RP82-UI01 失败。 | 作者扩已知文字字段，并仅沿 `content` 和原领域结构容器迭代；不遍历请求、操作或任意 JSON。原正文断言通过，作者追加原主题/物品/结构化设定例通过。 |
| REC82-02：实际单条标签记录被当未知内容 | P2 | 恢复校验失败后实际留下 `workspace/tab:<id>` 及原 `title`，投影仅支持整体 `tabs`，因此标题不可见。RP82-03 调用真实恢复函数验证。 | 作者兼容单条 `tab:` 标题；原失败断言通过。 |
| REC82-03：集合上限产生无提示的正文省略 | P2 | 原 chatSession schema 接受 4097 条短队列，全部预览远低于 100,000 字符；投影在 4096 条截断且 `truncated=false`，最后输入不可见。RP82-04 失败。 | 作者删除静默条数截断、队列按序编号；最后输入可见、重复队列内容保留，仍按文字预算明确提示过长。原断言通过。 |

这些缺陷影响预览/复制的完整感知，未证明持久原稿被删除或完整导出丢失。它们不被升级为数据丢失结论。

## 独立行为与实际 React 核验

- 六项独立 Node 检查：原设定与角色正文、由真实恢复生成的单标签记录、4097 条合法队列、执行/未知元数据保留而不投影、旧原因保持且新隔离源及 autosave 使用 `WORK_RESTORED`、保留稿跨下一次恢复往返。逐项比较原值，投影不修改数据；隔离分支不调用验证器或执行请求。
- 三项独立 React 检查：真实 textarea/按钮复制已知正文；未知记录禁用复制；完整导出包含被隐藏的空 autosave、请求元数据与所有原值；全空展示仍可导出；新增正文排序不改变已选择的未知记录；旧 opt-out 和新作品恢复原因同时准确显示；包含 `<script>` 的作者原文字面显示而不执行。API、剪贴板和导出为隔离受控桥，归档请求没有被执行。
- 同轮相关回归覆盖 100,000 字符预览提示及“复制预览”、长原文完整导出、原三栏布局/尺寸/Escape、复制/导出失败保留，以及真实 bootstrap 对 pending/activated/failed barrier 强制惰性保留。正常用户 `restoreSession=false` 仍使用旧原因；持久 barrier 不改用户设置、不宣称未知/失败结果恢复成功。
- 原 REC56-R01 的 operationId 可见断言因明确新合同改为 UI 不显示；完整导出仍包含原 operationId 的断言保持。本审核核对这一契约调整，不将原展示断言改动当作完整数据验证被删除。

## 证据与夹具说明

独立新增：`tests/unit/recovery-preview-review.test.ts`（6 项）、`tests/browser/recovery-preview-review.test.ts`（3 项）。最终 SHA 已单列 v2 `independentTests`，不会把纳入作者清单等同独立审核通过。

- `review82-01-initial-manifest.json`：v1 初始 26 项和原聚合全部匹配。
- `review82-03-independent-corrected-red.tap`：独立 6 项，2 PASS/4 FAIL，均为实际展示断言。
- `review82-04-independent-react-red.tap`：实际 React 3 项，2 PASS/1 FAIL，设定正文未展示。
- `review82-06-independent-fixes-green.tap`：定向修复后的独立 6/6。
- `review82-07-final-related-node-green.tap`、`review82-08-final-related-react-green.tap`：审核者最终实跑 46/46 与 10/10。
- `review82-09-final-typecheck.txt`：全项目类型检查退出 0，0 字节诊断。
- `review82-10-final-manifest.json`：v2 全部 32 项与聚合独立核验。

`review82-02-independent-red.tap` 中最初 RP82-03 手写 tab ID 未满足原 `buildTabId`，这是审核夹具错误；03 已改用真实构造器，随后真正失败发生在已保留记录的原标题投影。RP82-02 的 `background` 在最终夹具更正为原 CharacterForm 实际 `bio`，原小传文字及其他正文断言不弱化，原 RED 保留。作者 06/10 既有 CSS/bridge 夹具错误及并行 phase16 any 问题未被计作本轮产品缺陷。

## 限制

本轮是冻结源码、隔离 Node 行为与实际 React/BaseUI/Chromium 审核；未独立运行 Electron、操作系统剪贴板/文件选择器、真实导出文件主进程接线、Windows 或 531 项正式验收。主进程导出及后续原生复验由主代理另行完成。本报告不把旧草稿可读投影当作执行请求或审批提交能力，也不提升更早分段审核的验收范围。
