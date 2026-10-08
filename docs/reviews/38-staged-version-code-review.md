# 暂存正文版本边界独立审核

日期：2026-10-07（Asia/Shanghai）。范围：三阶段保存的合成回执、正文自动保存/冲突判断、GET 基线、暂存批次的首帧控制字段及外观冒烟的断言范围。仅新增/更新此记录和 `tests/unit/staged-version-boundary.test.ts`，未改实现、未操作运行中的 Electron。

## 结论

**复审通过当前版本边界修复，SV-01（P2）已闭合。** 首审受控回归得到 2 个 RED、1 个保护性 GREEN；修复后独立执行 4 项版本边界测试与 5 项已有外观配置测试，9/9 GREEN。本记录保留首审原因，不宣称真实 App 的完整验收通过。

主代理在 macOS 隔离 Electron 外观测试中报告的初始提示，与以下修复前源码链一致。外观设置本身没有更新 Chapter 的动作；无需存在外部写入，单独的“暂存成功后再次编辑/撤销”就足以触发旧实现的版本不一致。当前实现已修复，并已核对主代理原生冒烟的无假冲突通过证据；具体范围见文末。

## 首审 SV-01 · P2 · 虚拟版本混入持久版本边界（已闭合）

以下为修复前源码与首审观察，不代表修复后的当前实现。

定位：`src/lib/staged-save.ts:419–428`，`src/stores/staged-changes.ts:343–380`，`src/components/content/ChapterContentPanel.tsx:105–121` 与 `381–385`。

实际路径：

1. 原正文面板通过 `apiSend(PATCH)` 自动保存；命中启用的三阶段拦截后，只写入 Zustand 暂存批次，并没有发送数据库 PATCH。
2. `buildSyntheticReceipt` 合并本地正文，但同时把快照 `version=v` 改成 `v+1`，把实体 `updatedAt` 改成本地当前时间；暂存仓继续缓存这个合成实体作为下一帧的影子基座。
3. 正文保存回调无条件把回执 `chapter.version` 写入 `versionRef` 和 `baseVersion`，调用 `onChanged(version)` 登记自己的版本并失效章节查询。
4. GET 从真实数据库读取，仍返回原正文及 `version=v`。stage one 没有进行 `updateChapterContent`，所以这不是外部回退/新修订。
5. 首次暂存结束时 AutosaveController 的 status 是 `saved`，冲突条件暂时被遮住；再次输入或 Monaco 撤销安排新的自动保存后，status 变成 `pending`，`chapter.version !== baseVersion && status !== "saved"` 成立，显示“当前稿已有新修订，本地草稿已保留，请重新比较”。实际上比较的是真实 v 和虚拟 v+1。

自己的同步令牌登记只能帮助维持组件 key；它没有让真实查询数据推进到 v+1，也不能让不存在的数据库版本成为正文基线。反复暂存还会把虚拟版本继续增加。

`versionRef` 也用于打开历史、定稿检查及生成等显式动作的 expectedVersion；修复时应一并确认这些动作不会取得虚构持久版本。这里仅作源码边界提示，本审核没有实际执行这些动作或断言它们的完整服务结果。

## 为什么不能推断最终暂存提交必然冲突

`src/stores/staged-changes.ts:90–107` 在合并同目标修改时保留第一次请求的 `firstControl`，包含真实 `expectedVersion` 与原 operationId，同时保留最新数据字段。`src/lib/services/staged-commit.ts:163–172` 从这组首帧字段调用受版本校验的 `updateChapterContent`。

STAGED-V03 已确认两次实际 apiSend 暂存后，批次中只保留一条修改、首帧版本仍为 7、原 operationId 不变，正文为最新一帧。该路径抵消了后续局部虚拟版本对批次最终 expectedVersion 的污染。因此当前证据证明的是面板假冲突/错误版本回执，不能扩大成已经发生数据库覆盖或最终提交必然失败。

## 最小修复建议

- 修改型合成回执继续合并影子数据，但保留快照中的真实 `version`、`updatedAt`。不要用本地暂存时间/计数冒充持久化实体令牌，也不要让请求体中的同名字段覆盖权威基线。若需要本地修订计数/时间，使用现有 controller.revision、StagedChange.updatedAt 或独立的草稿字段。
- 保留暂存批次的首帧真实 precondition、幂等 operationId 和最新正文合并语义。真正服务提交成功后，继续依靠真实回执推进正文版本；不要通过删除冲突判断、伪造 GET 版本或降低服务层校验消除提示。
- 影子内容缓存仍可用于下一帧 diff；它不需要虚构数据库版本链。同步更新 helper/store 中“版本链连续”的旧注释。上游 Web 的对应 helper 与桌面文件内容相同，且原 `scripts/tests/staged-save.test.ts` 仍把版本+1和时间刷新写成成功预期；后续实现修复应更新适用的旧断言，但本子代理未改上游文件。
- 修复后需保留真实外部提交导致的冲突/草稿保护；不能只验证提示消失。本文没有对未暂存期间的全部外部同步竞争行为作通过声明。

## 首审独立受控验证

新增 `tests/unit/staged-version-boundary.test.ts`，Node 24.19.0 直接运行 `node --import tsx --test tests/unit/staged-version-boundary.test.ts`：3 项中 1 通过、2 失败，退出码 1，无跳过/取消。

| 稳定 ID | 受控操作与 oracle | 首审结果 |
| --- | --- | --- |
| STAGED-V01 | 原实体 version=7、固定 updatedAt；调用实际合成回执 helper 暂存修改，正文需变化、输入快照不变、持久 revision/time 不变。 | RED：回执为 version=8，updatedAt 改成本地当前时间。 |
| STAGED-V02 | 运行实际 apiSend、tryStageRequest、暂存仓与 AutosaveController；注册只读快照，第一次暂存零 HTTP 写；然后撤销安排 pending，再经实际 apiGet 读取未变化基线；编辑器保存回调取得的持久基准必须仍等于 GET。 | RED：基准 8、GET 7；网络 ledger 只有 GET，无 PATCH。测试没有自行实现合成 helper，也没有真的渲染 React 警示条。 |
| STAGED-V03 | 连续两次实际 apiSend 暂存，第二帧沿第一帧返回的版本；检查合并批次的首帧真实版本/operationId 与最新正文。 | GREEN：一条修改，真实 expectedVersion=7、原 operationId、最新正文均保留。 |

测试不使用真实作品/Key、数据库或模型服务；mock fetch 只在测试进程内读取固定 fixture，清理时恢复。V02 复刻面板保存回调对版本的赋值，但没有把复制 React 条件当作测试 oracle，判断的是实际运输回执与未变化 GET 的持久版本一致性。源码中的冲突渲染条件与这个 RED 独立对应。

## 真实 Electron 场景的后续验收

首审时 `scripts/smoke-appearance.mjs` 检查编辑草稿/Monaco 实例/撤销/外观参数保留和 pageerror，没有断言不存在假修订提示；因此那次外观断言通过不能证明正文无冲突。复审只读看到脚本已新增撤销后的假修订提示计数断言；本子代理没有运行它，没有启动、关闭或操作 Electron。主代理初始截图是现场线索，本记录的独立证据是源码与受控 RED/GREEN。

实现修复后，在原隔离 Workspaces 夹具中验证：输入→等待暂存→打开设置修改外观→关闭→撤销/重做，数据库正文/version/ContentVersion 未提前提交、无假外部冲突、编辑实例与草稿/撤销栈保留；正式三阶段提交后才得到真实新版本。另加入真实外部更新并保留本地草稿的反向场景。这些真实桌面场景目前未由本次审核执行，不能标记为完整 App 或 Windows 验收通过。

## 修复复审与最终结论

已定向复核 `buildSyntheticReceipt`：`stagedDataFields` 生成独立的数据对象，合并前删除其中的 `version`、`updatedAt`；合成回执从快照取得权威字段，停止版本+1和本地时间替换。请求体同名字段无法覆盖已有令牌，快照没有这些字段时也不会由 body 凭空创建。影子正文合并、首帧控制字段和真实提交服务的版本校验没有被移除。

在原 3 项回归之外，按主代理要求仅新增 STAGED-V04：冻结的 body 同时携带 `version=999` 与未来 `updatedAt`，分别以有权威令牌和没有令牌的快照调用实际 helper；前者保留快照值，后者不出现两个字段，草稿内容正常合入且原 body 未被修改。未扩大到其他业务或运行原生 Electron。

独立 Node 24.19.0 执行：

```text
node --import tsx --test tests/unit/staged-version-boundary.test.ts tests/unit/appearance-settings.test.ts
```

结果：9 顶层测试全部通过，0 失败/取消/跳过，退出码 0。其中版本边界 4 项：V01 保留真实 version/time、V02 实际暂存运输与未变化 GET 基准一致、V03 首帧真实 precondition/operationId 和最新内容合并、V04 body 同名字段不能覆盖/创建权威令牌；另外 5 项为已有外观设置状态测试，不计作新增的正文版本用例。

**SV-01 在本批代码审核与受控回归范围已闭合。** 首审对上游同源代码的描述是修复前的比较记录，本次仍未修改上游。残留“版本链连续”类旧注释由主代理同步，不构成当前功能阻断。原生场景的无假冲突断言已进入主代理后续 smoke 范围，需以其实际执行证据为准；本次 GREEN 不替代正式三阶段提交、真实外部并发、macOS/Windows 全部验收。

## 原生冒烟证据补充

独立只读核对 `docs/evidence/implementation-03/appearance-latest.json`：主代理于 `2026-10-07T11:31:17.862Z` 至 `11:31:26.042Z` 在 macOS development Electron 执行原外观脚本，`status=passed`、`errors=[]`，checks 第 3 项为 `staged edit and undo do not report a false committed-version conflict`。脚本实际在编辑→修改外观→回正文→Monaco 撤销后，执行 `getByText(/当前稿已有新修订/).toHaveCount(0)`；并保留草稿/编辑器实例/撤销、正文与预览外观的相关断言。

这份主代理真实运行记录为 **SV-01 原报告场景的 macOS 开发版原生回归通过** 提供证据。审核者只是读了实际脚本及产出 JSON，没有冒称自己启动/操作了 Electron。范围限定为此隔离夹具中的外观/编辑/撤销流程；JSON 本身明确排除完整和 Windows 验收。正式三阶段提交、真实外部并发反向场景、打包分发以及 Windows 全部验收仍不能由这份证据替代。
