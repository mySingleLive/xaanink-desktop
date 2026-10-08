# 第86轮独立审核：恢复草稿导出接线

日期：2026-10-08。审核者：`product_revision_review`。结论：**限定 PASS**。发现并关闭1项P2；本轮新增主进程接线及恢复格式未发现剩余可复现阻断。

## 独立性与范围

审核者是第16批通用 `FileExports` 原作者。因此本结论是第21批 root 作者的独立新增接线审核，重点为专用 recovery owner、失败关闭入口、实际目标保护复用与关闭等待；不重作第16批核心的独立PASS。第16批由第83轮其他代理独立审核，历史保留。

只读检查 `makeRecoveryExports`、`exportDraftSnapshot`、`CloseCoordinator.exportDraft/closeData`、`desktop:draft-export`、`releaseOwner`；对照恢复格式严格校验、共享失败文案及既有内部目标保护。未改生产源、作者测试或原生脚本；新增独立 `tests/unit/recovery-export-review.test.ts`。

## 发现与修复

**RE86-01 / P2（已关闭）**：关闭失败后的 `exportDraft(owner)` 等待 `closeChannel.request`，回执抵达后未再次比较原 CloseOwner。实际 main 闭包在等待期间由窗口8/旧nonce换为窗口80/新nonce后，调用 `exportDraftSnapshot` 会取得新窗口权限，打开新 chooser 并导出旧窗口草稿。独立RED为 `review86-01-independent-red.tap`（3通过、1行为失败）；不是编译或夹具错误。

root 在 awaited channel 回执之后、进入导出之前核验当前窗口存在/未销毁、webContents ID、draftSession owner与sessionId全部等于传入 owner。旧回执现在明确拒绝，chooser调用0次、目录无落盘。原独立断言保留，未由审核者修改生产源。

其余独立用例首次GREEN：保护目录获取失败保持原文件且不使用空清单；未ready/关闭失败仍能导出六类sources/未读issues和惰性请求数据；已登记与未登记作品的manifest/锁/database及应用根/bootstrap不可覆盖；选择器等待期间换nonce拒绝；取消返回false；坏UTF8、未知信封字段和超过16MiB快照在chooser前拒绝。

`releaseOwner` 使用精确`${ownerId}:`前缀撤销恢复导出。独立实际main +真实FS暂停post-rename目录同步时，撤销不能把物理IO变成已完成；`closeData`的`recoveryExports.flush`确实阻止worker close，放行同步后才关闭。已重命名惰性JSON保留，没有成功ACK。release事件自身是同步撤销，不声称事件回调等待了操作系统IO；真正等候位于closeData。

## 最终验证及冻结

- 新增独立7/7通过，相关6文件27/27通过、0跳过、exit0；不累计重复日志或root作者67条。
- 全量TypeScript exit0、无诊断；限定diff检查0。
- 第21批v2共34份SHA全部匹配，按sources/tests/harnessUpdates/native/dependencies/evidence顺序与末LF重算聚合 **`4b467759191d78e37210bff29a6b5b2ed47a032e6521da0c226662651070d7af`**；v1保留，v1检查只发现预期main修复漂移。
- 独立测试最终SHA：`c2b1de243f876d01e880f37ac2160ec31adecf91d0fe52bd2a7cf8892a3029c4`。

证据位于 `docs/evidence/implementation-21/review86-01...08`，其中03为独立7项、05为相关27项、04为完整类型检查、08为逐文件与聚合核验。作者新增5项、root相关67项及macOS smoke3组是作者提供的旁证，不与本审核实跑混计。

## 实际限制

独立测试抽取实际main函数/闭包，使用受控窗口、channel、SaveDialog返回与实际`FileExports`/真实隔离磁盘，不启动Electron或操作系统选择器。root的macOS开发联调记录明确控制picker/activate；本轮仅读其摘要，未独立复跑，也未用其截图宣称物理OS窗口/Dock/Windows/真实故障或正式531条验收完成。恢复JSON的请求字段完整保留为普通数据，审核未调用任何恢复请求或付费模型。
