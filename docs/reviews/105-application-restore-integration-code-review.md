# 第36批恢复接线增量独立审核 105

2026-10-08；审核者 `/root/application_restore_review`。**限定范围 PASS**：两处真实独立RED均已修复并保持原oracle通过，冻结后的21文件相关回归185/185 GREEN、全仓types exit0。本结论只覆盖本次core/producer/authority源协议与main checkpoint/preflight/metadata flight helper，**不授 main/UI/冷worker/native/531 PASS**。第104号有限PASS仍是原冻结历史，不能挪作新源码结论。

仅新增独立测试和审核/证据，未改生产或作者 oracle。不运行 PG/native App、不读用户数据或真实密钥、不调用供应商。隔离真实 Node 子进程、实际 PID 退出、真实磁盘 journal/barrier/request 可使用；core activation 目前仍是明确 FS seed fixture，不能冒称真实 producer/PG。

## 范围与状态

root新增 `desktop/main/application-restore-checkpoint-session.ts`、`application-restore-preflight.ts`、`desktop/shared/application-restore-checkpoint.ts`，并给 ApplicationMetadataGate 增加 AsyncLocalStorage 物理写入 flight。source union四文件为 `desktop/core/application-restore-activation.ts`、`desktop/core/root-authority.ts`、`desktop/shared/application-restore.ts`、`desktop/service/database/application-restore.ts`。上述八个生产文件冻结、定向审查并以真正FS/私有能力/原回归验证；root另接的 main/UI/冷worker未纳入本报告结论。

| 独立反例 | 实际行为 | 修复/证据 |
| --- | --- | --- |
| G02 | writeFlight 内忽略返回值的实际 `gate.write(readFile missing fixture)` 失败后，父 flight 正确 reject/drain，但 async write 返回的额外 wrapper 仍产生第二次 unhandledRejection。支持 detached child 的新 API 不能只捕获内部 child 而漏掉对外 wrapper。 | `review105-01-metadata-detached-red.tap` 2 GREEN/1 RED；root只改生产，held 分支返回原 tracked Promise、普通路径移到 async helper。原 oracle在03独立复验 GREEN。 |
| C01 | protected read 在实际 journal open/IO等待期间遇到 schema/checksum合法的不同 operation retention；await 后只核owner，仍返回旧 operation 恢复 bundle。 | `review105-02-checkpoint-read-red.tap` 1 GREEN/1 RED；root新增完整 retention 文件 proof 与 await 后控制/retention 再校验，原 oracle在05独立复验2/2 GREEN。此反例限定为读取一致性，不声称实际 consume/activate 绕过。 |

## 独立用例

新增 `application-metadata-flight-105-review.test.ts`、`application-restore-checkpoint-session-105-review.test.ts`、`application-restore-preflight-105-review.test.ts`、`application-restore-source-union-105-review.test.ts`，均在 `tests/unit/`，共13项独立用例。

- G01：仍活跃的 detached writer 后续新增 grandchild 实际任务，capture等全部完成。
- G02：隔离真实 Node/实际ENOENT IO，父任务报告失败后无额外 unhandledRejection。
- G03：active flight 内 acquire 快速拒绝，后续普通 capture仍可用，外部写等待其释放。
- C01：跨真实 journal IO之后保护操作被替换，不发布旧bundle，原源/外来 metadata 保留。
- C02：capture排队期间实际 native owner和journal owner撤销，释放capture后零写入，仍保持protected。
- C03：实际 journal 保存期间以相同字节替换 retention inode，不发行first attestation；已提交journal中完整惰性恢复项保留，两个retention副本不改。
- P01：hardlink保护文件为unknown/cold，两条链接内容都保留。
- P02：activated根被外来inode替换时cold，foreign open次数为0，外来内容保留。
- P03：genuinely fresh bootstrap存在未知 recovery namespace临时记录时cold，不生成/清理文件。
- U01：公开 cold proof.assertCurrent替换noop，不能掩盖最终原生确认期间实际managed session文件变化；拒绝CAS，原draft/raw副本保留。
- U02：不同bootstrap即使复制相同合法pointer，也不能重新绑定genuine闭源cap；拒绝前不改candidate、保留原cap供原bootstrap合法reseal。
- U03：实际producer旧v1健康activation接续真实v2闭源activation；完整旧history/provenance与receipt bytes保留。SQL和verified健康回调仍是明确protocol doubles，两个源engine打开计数都为0。
- U04：strictclosed-source夹带兼容/未知字段均拒绝、不生成audit；同一原cap之后合法prepare/cancel可用。

`review105-03-preflight-gate.tap` 为6/6 GREEN；`review105-05-checkpoint-read-green.tap` 为2/2 GREEN（920.42375 ms）；`review105-06-source-checkpoint-attempt.tap` 为7/7 GREEN（4429.580417 ms）。04/07为开发期间types exit0快照。最终冻结验证另列如下，不推断尚未读取或新增源码正确。

## 最终冻结及回归

`review105-09-final-related.tap`：21个测试文件、185/185 GREEN（36703.095375 ms），fail/cancelled/skipped全部0；包含全部13独立105用例、作者21项source union、旧102/104私有能力负例、实际PID请求、root authority混合链、冷源保留、原journal/retention/barrier与metadata gate回归。测试使用4文件并发、每项有界timeout；未开启PG或native应用。

`review105-10-frozen-full-types.txt`：`tsc --noEmit --incremental false` exit0、空诊断。测试前08与测试后11核对两个新freeze，共67个去重文件/manifest全部一致；聚合SHA256为 `46187a8f16fa38e420dc800cf41d6458617a62b4701fcbb6248a60f82a00e19b`。12额外核对当前controller使用的request v3 readonly依赖freeze，共78项全一致，聚合 `53d5bce584da39df560c310f37b13a3950e20448c024ceec8e2f4ab5abb5c1d7`。完整路径、bytes、SHA与原manifest对照见08/11/12 JSON，原RED日志未覆盖。

| 当前冻结 | 列出项 | manifest SHA256 |
| --- | ---: | --- |
| root-checkpoint-protection-frozen-v1.json | 12 | `47e4a998e44336b4aa8321fd83afa54320c74c179dd5d7731f1f9fad6bbf3d4c` |
| application-restore-source-union-frozen-v1.json | 54 | `21fa0e8d7d73d20721d96e208d7c0f27ff0e031e9558a04c0948e49c0904d06e` |
| application-restore-request-freeze-v3.json（readonly） | 10 | `d61eb7c1035cb98199784938a7407779946f3f5ceec6efea775567405a55cc06` |

旧35原manifest保持原样，113项中108项当前未变；仅本次已授权source union四文件及metadata gate发生变化。本报告没有把旧35健康PG结果授给36新分支。旧helper v2源码仍为 `905ebaf35c2bd793d24ece614082a149583cecadf638bd681cd452e5087a87ec`。

源协议复核：真正closed helper cap和producer cap均仍在WeakMap私有发行链内，operation/app/actual pointer/current root/native parent精确绑定；公开receipt/method/clone不能发权。新strict三个sourceKind严格对应字段矩阵，v1可信旧调用只允许实际healthy/missing，closed sealed cap不允许降级。pre-CAS源proof核旧authority，post-CAS用原捕获source-only seal与activation自有新pointer/receipt CAS控制封口配合；不确定提交拒绝重放。v2 beforePointerText与原UTF-8 bytes/size/hash/semantic pointer完整一致。旧v1与新v2历史、两个mixed chain及二次恢复后的迁移已真实FS验证；不存在读取未知源来掩盖物理身份损失的分支。

## 未授予的范围与后续

1. main/preload/renderer新接线、冷worker、完整旧PID/engine/session关闭、原生文件选择及锁所有权必须另行审查/原生验证。本次actualPID/request测试及seed core checkpoint fixture不等于整个应用启用流程。
2. actual原schema PG的36closed-source组合未运行。source union的SQL和healthy verifyCaptured回调明确为protocol double，只授FS/能力/CAS结论。正常引擎/窗口/session及所有业务惰性不能从这些替身推断通过。
3. 请求层再次恢复、executing/unknown旧尝试弃用入口仍另审；核心二次FS能力不等于该用户入口完成。连续migration覆盖旧live journal且无append-only witness仍归第38批；reader保守阻断，不猜证据。
4. 没有安装包/build、MacOS/Windows native、真实供应商或正式531验收结果；正式531全部not-run。root新RecoveryDialog/Chromium mock bridge开发检查也不纳入105 PASS。
