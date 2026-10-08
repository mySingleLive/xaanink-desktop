# AI 输入框剪贴板独立代码复审

- 日期：2026-10-07。
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批实现作者。
- 结论：**本批实现与隔离行为验证限定通过（PASS）**。两项独立复现的缺陷已修复；26项真实 React/Chromium DOM 测试和22项受控 Node 回归全部通过，无跳过或取消。全量类型检查曾被另一批评论草稿测试的3个类型错误阻断，不能据此称全项目检查通过。
- 范围：`native-text-edits.ts` 的 composer 剪贴板分支、`ChatPanel.tsx` 的粘贴/复制/剪切及草稿同步接线、`composer-editor.ts` 的引用水合与桌面原生编辑历史。仅增加独立测试、修订旧测试 oracle 和审核记录，没有修改实现，也没有运行 Electron。

## 发现及关闭证据

| 问题 | 修复前实际行为 | 修复及独立复验 |
| --- | --- | --- |
| CMP52-01 · P2 | 等待剪贴板时，同一 chip 的 `data-insert` 从A改B再回A，最终HTML和选区完全相同。旧观察器只观察 `contenteditable` 属性，因此迟到粘贴仍被执行。 | 本审核在实际 React/Chromium 中复现，RED为0/1通过。当前编辑宿主及其子树的全部属性纳入 MutationObserver；只观察该宿主，不观察其他页面。修复后旧请求拒绝、没有 insertHTML、原引用和草稿均保留。 |
| CMP52-02 · P2 | 全选剪切后 Chromium 留下单个未标记BR用于光标；正文与草稿都为空，再全选复制却向剪贴板写入一个换行。选区克隆失去原宿主class，原空占位判断没有生效。 | 第一项已修复时独立执行2项得到1通过1失败。`isDesktopEmptyCaret` 在原宿主上判断，并由 `selectedEditorText` 在克隆前返回null。空占位不复制；实际粘贴的单换行带内部marker，仍可复制为一个换行。两个方向的断言均通过。 |

两项均由本审核真实行为测试首先复现，作者修复实现，独立测试的行为断言保持不变。先前作者发现的文本节点ABA、异常回调、合法单换行和撤销问题属于作者TDD历史，不冒称本审核新增发现。

## 复核的实现行为

自定义粘贴先等待有界纯文本读取，重新核验目标身份、窗口及控件焦点、连接状态、编辑性、选区节点/偏移、HTML、事件代数和最新操作票据。当前宿主MutationObserver同时捕获文本、节点与属性往返；完成、失败、后续操作及dispose均解除观察。迟到输入、焦点往返、只读、卸载、IME开始或已被后续菜单操作替代的请求不能插入正文。

通过校验后，composer分支派发真实 `ClipboardEvent`/`DataTransfer`，只有 `text/plain`。原React `onPaste` 消费实际事件的私有同步ACK，复用现有 `chipHydrate`、`renderDraftIntoEditor` 和类型化引用序列。缺少处理器、回调失败（包括 `throw undefined`）、原生插入拒绝时均报失败；没有退回普通 `insertText` 绕过引用水合。普通input继续原纯文本插入路径。

桌面 insertHTML仅来自原文本节点与受控chip生成器；不读取或插入剪贴板HTML，标签、组名及普通正文仍经DOM文本属性生成。真实测试证明含标签的剪贴板文本不执行，稳定引用 `@[组/名](标识)` 可水合、复制、剪切和恢复。候选索引和草稿store在测试中受控，这不证明完整实体归属或所有业务引用。

桌面粘贴/剪切使用实际 Chromium insertHTML/delete，undo/redo也调用浏览器编辑历史；原 `syncFromEditor` 更新同一草稿，没有重建当前composer DOM或清空undo。单BR空宿主保留给浏览器历史，合法源文换行用内部标记区分。Web分支继续原Range插入、原cut默认行为和原空输入清理，本批没有改Web布局、消息发送、引用协议或模型选择。

自定义copy/cut写出原选区的稳定引用文本；写失败或晚到回执不删除原内容。读取、类型和1MiB长度限制、缺处理器、并发菜单操作及释放均有回归。已经发给系统的剪贴板写入不能撤销；这里验证的是晚到cut不删除正文，不是可回滚的系统剪贴板事务。普通input通过原值/选区/事件保护，其程序化value无input事件的A→B→A不在本批证明范围。

## 旧47测试 oracle 修订

`tests/unit/composer-text-edits-review.test.ts` 的CMP47-07原先要求composer调用insertText，其控件替身也没有ClipboardEvent/DataTransfer。该要求与本轮批准的实际onPaste水合路径冲突，因此按主代理授权修订：事件通过实际 `consumeDesktopComposerPaste` 的私有ACK消费，一次纯文本事件后完成，document.execCommand不出现insertText回退。没有直接改WeakMap、关闭安全守卫或伪造ACK；其他焦点/选区/IME/只读/卸载断言保留。

该11项是受控Node对象，不证明浏览器水合。真实React、真实ClipboardEvent/DataTransfer、Range、DOM和编辑历史由另26项Chromium测试独立证明。旧oracle适配不计为产品RED；作者保留的旧21/22日志也不累计为本轮通过数量。

## 独立执行与冻结

证据位于 `docs/evidence/implementation-07/`：

- `52-token-attribute-aba-red.tap`：1项实际失败；`52-placeholder-copy-red.tap`：1通过1失败。
- `52-final-dom-independent-green.tap`：作者24项及新增2项独立测试合跑，**26/26通过，退出0**，0跳过/取消。测试从当前ChatPanel TSX AST提取实际回调挂到React19，使用既有隔离无界面Chromium1228、实际编辑历史；页面网络全部阻断。
- `52-final-node-independent-green.tap`：4个文件**22/22通过，退出0**，含修订后的11项composer守卫和11项普通input/接线回归。受控文档替身不能单独证明名称中所称的原生undo行为。
- `52-composer-guard-oracle-green.tap`：11项旧测试修订后的单独执行；与上述22项重叠，不另累加。
- `52-final-independent-typecheck.txt`：全项目tsc退出2，仅另一批 `desktop-comment-drafts.test.ts` 第16/20/25行访问缺失 `issues.comments` 的诊断；本批文件没有诊断。后续全项目结果应另留证据，不覆盖该记录。
- `52-review-scope-typecheck.txt`：使用原tsconfig、仅排除上述在途测试文件的TypeScript完整program检查退出0；保留所有桌面及Web源码和其余测试。此结果是限定类型复核，不能替代全项目检查。
- 最终执行、受审文件及证据指纹见 `52-independent-summary.json`。

最终 `composer-clipboard-placeholder-frozen.json` 的4项文件SHA及有序聚合独立核对全部匹配，聚合为 `09a4de9678d112aa5d4486410563251821ed0daf66293a034ed48c6130d099bf`。算法是有序 `path:sha256` 记录以LF连接、末尾无LF。原冻结及第一次属性修复冻结保留为历史，不混用。

## 验证边界

本批是隔离React/Chromium DOM及受控核心复审，剪贴板桥、候选数据和store都是替身，没有使用系统剪贴板、用户资料、远程网络、付费服务或真实数据库。没有运行Electron或操作主代理的浏览器。

真实原生菜单、默认键位passthrough、系统剪贴板权限、物理IME候选、macOS/Windows两平台、原生窗口焦点及完整App仍需主代理独立验收。此结论不代表这些场景通过，也不更新或抵扣正式顶层用例；作者24项和其他阶段既有PASS不得累计成完整桌面验收。
