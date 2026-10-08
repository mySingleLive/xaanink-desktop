# 84 · 应用级备份与隔离恢复独立审核

状态：限定通过。六项实际缺陷已由作者修复，最终独立串行执行 38/38 通过、0 跳过，完整类型检查退出 0；正式 v2 的 136 条 SHA 与聚合全部匹配。受审是第 17 批核心，不包含主进程/IPC/UI/启用权威根接线、Electron 闭库重启、Windows 或 531 条正式验收。审核者没有修改生产实现、作者用例或作者冻结。

## 范围与冻结

初始合同 `docs/evidence/implementation-17/application-backup-contract.md`；作者交接 `docs/reviews/application-backup-implementation.md`。生产范围为：

- `desktop/shared/application-backup.ts` 的包/候选 schema 和容量声明。
- `desktop/core/application-backup-files.ts` 的受限读取、复制、散列和身份证明。
- `desktop/core/application-backups.ts` 的 captured→verified、列表和保留清理。
- `desktop/service/database/application-restore.ts` 的隔离 PGlite/原迁移/全局语义、候选封存与撤销。

初始 v1 冻结聚合 `c267bb211773bee924b63d20786e63153d11ba30a8c10b7d3bffa7af1465efd3`，9 作者文件、82 只读依赖、27 证据的 118 条 SHA 与聚合全部独立匹配，记录 `review84-01-initial-manifest.json`。后续修复须核新冻结，不把旧清单与修后源码混称一致。Workspaces 的原 `catalogSchema` 由根代理仅增加 export；这是复用既有领域结构的授权依赖变更，不是另造同义 schema。

修后源码先冻结为 `SOURCE_FROZEN_AWAITING_FINAL_38_TEST_REPLAY`，运行中的最终日志明确排除；135 条 SHA 与 `501537ef6607f5d22352381a06ab97217ec5b29b7a053935056573044b69f0f6` 聚合全部独立匹配，记录 `review84-pending-source-manifest.json`。这仅证明受审源码稳定，不代表尚在运行的 38 项已通过；最终日志完成后再核正式 v2。

正式 v2 聚合为 `e726f6f2c60076207cea23c1086c191ce7620aadd14f1c7dce2a1b174abedf03`，9 作者文件、2 独立测试文件、82 只读依赖、43 证据共 136 条全部独立核验一致，记录 `review84-12-final-manifest.json`。聚合按上述分组顺序连接 UTF-8 `path:sha256`，每条记录含末尾 LF。v1 与 pending-v2 保留，作者仅汇入已经完成的最终日志；四生产文件与实际运行时的修复版一致。

## 独立发现及修复复核

| ID / 级别 | 原始实际行为 | 要求与定向修复 |
| --- | --- | --- |
| AB84-01 / P1 | 旧包已开始清理后，新包的 state 文件在下一次关闭证明 await 处被真实改写；循环仍删完尚未处理的旧历史 state，最后虽然 create 拒绝，旧历史已不存在。 | 每次不可逆删除前重新确认新包仍为已散列/语义验证的当前副本；新证明失效时保留旧包剩余字节，不要求回滚已经删除的文件。作者新增同步 tree/metadata seal 复核后才删除。 |
| AB84-02 / P2 | 候选完整散列后、最后异步 owner guard 期间，state 同 inode 改写，verify 仍返回 obsolete ready。 | 最后异步边界之后复核已散列文件/目录的身份、版本与成员，返回前不再释放一个未校验窗口；prepare 的成功返回同样核最终证明。 |
| AB84-04 / P2 | 已有 1000 个未知邻条目的容器仍成功生成第 1001 个包，后续 list 反而因上限而失败。 | 创建前必须留出一项容量；关键阶段和返回前有界复核，未知邻项不自动删除。作者采用最多读取 1001 项的同步目录计数。 |
| AB84-05 / P2 | metadata 临时文件写好后，其 pathname 在 owner await 处被外部新 inode 替换，owner 拒绝；共享 atomicWrite finally 仍 unlink 外部替换文件。 | 临时路径不是所有权凭证。第 17 批限定 metadata writer 捕获 wx fd 身份/版本/字节，rename 前核当前临时文件及 target CAS，失败仅清同一 owned inode，保留 foreign 字节；不修改共享 VersionedStore 领域逻辑。 |
| AB84-I02 / P2 | 真实原 schema/PGlite 的候选被 prepare 标 ready、新包标 verified，但同一候选实际 Workspaces.initialize 拒绝缺 id/identity 等字段的 catalog。 | mandatory verifier 的应用语义必须核原 catalog schema；合法失联作品引用仍应保留而不打开该作品。作者复用原 catalogSchema 校验信封。 |
| AB84-I05 / P2 | 当前 profile 的 avatarAssetId 是合法 UUID，但包内无对应 PNG，实际 prepare/create 仍给 ready/verified。 | 核当前引用与包清单的关联，缺失拒绝；存在时仍走已有 sharp 的真实 PNG/页数/像素/字节校验。此条由根代理明确要求关注，实际反例与断言由本审核独立执行。 |

以上六项都有纯行为 RED，无缺方法占位或人工假造测试失败。原始日志保留：

- `review84-02-independent-fs-red.tap`：3 项，1 通过/2 失败（01/02）。
- `review84-03-independent-pglite-red.tap`：最初 3 项，2 通过/1 失败（I02）；已确认实际 Workspaces 不兼容，并证明坏 settings/草稿保护旧包、整个当前源缺失仍可恢复。
- `review84-04-container-limit-red.tap`：4 项，3 通过/1 失败（04），此前 01/02 已修复通过。
- `review84-05-foreign-temp-red.tap`：5 项，4 通过/1 失败（05）。
- `review84-06-avatar-pglite-red.tap`：按 test-name 仅实际执行 I05 一项，0 通过/1 失败，不把过滤掉的用例计覆盖。
- `review84-07-independent-fs-expanded.tap`：最终 7 个 unit 断言当时为 6 通过/1 失败，唯一仍为临时文件归属；新增取消/owner 正向守卫首次即通过，不称这些为原始 RED。

作者修复后的日志仅用于交接，独立结论以本审核最终执行与指纹核验为准。最终串行回放中，以上六项对应的原独立断言全部通过，发现均关闭；没有放宽数据/权限 oracle。

最终运行预算校准：作者 `application-backups-32-final-review-related-green.tap` 在多个实际 PGlite 队列并行期间，I01 于约 264 秒报原 180 秒预算超时，随后明确中断；这是运行预算失败，没有数据断言失败，不能称 38 项通过。本审核同期 `review84-09-final-related-green.tap` 也主动停止，退出 1，仅保留未完成日志。初始独立 03 的同一 I01 已实际运行约 209 秒。经协调停止重复队列，本审核只把五个 integration 用例的 timeout 改为 600 秒，12 条数据/权限 oracle 原样保留，最终五文件使用 `--test-concurrency=1` 串行执行；不把超时或中断包装成产品 RED 或通过证据。

## 验证内容与证明边界

`tests/unit/application-backups-review.test.ts` 最终 7 项，真实隔离文件系统。01/04/05 实际写入/保留/删除字节与 inode；02 使用受控的合法格式 seal 生产者测只读返回边界，不冒称它是经实际 PGlite 生成的候选。其余验证 verifier 回执对象隔离、取消后等待真实 verifier flight 及队列再释放、owner 撤销不 promote/prune。unit 中语义 verifier、owner/关闭门是受控替身；这些用例本身不证明包健康或真实桌面闭库。

`tests/integration/application-backup-restore-review.test.ts` 最终 5 项，原 Workspaces/Prisma schema、已安装 PGlite 和原迁移。宿主 verifyCaptured 真正分配隔离新父目录，调用 prepare 复制、打开、核验并关闭该候选；源已经通过真实 Workspaces.close 完成关闭。它覆盖坏 state/草稿的 captured 与旧包保留、坏 catalog 拒绝、合法 offline 作品索引完整保留、当前 avatar 缺文件拒绝、当前整个源目录被删除后仅从健康包恢复。关闭的原库没有被 verifier 重新打开；无付费模型/远程服务/用户数据。

保留策略只有新包由 captured 经过宿主实际语义验证、再核原身份/散列后成为 verified，才能触发旧包清理。列表不把 captured 当健康；准备候选不信任 verified 字样跳过实际校验。完整旧包、未知邻项、失败 captured 和失败候选的保留事实按实际用例核验。checksum 是完整性，不是来源签名，跨机器可移动不表示 OS 保护密文可解密。

最终独立相关五文件为作者 unit 18 + 本次 unit 7 + 作者原库场景 1 + 本次原库 5 + 既有 inventory 7，唯一并集 38 项；不得再把作者旧 26 与新 38 重复累计。`review84-11-final-related-serial-green.tap` 已完整执行 38/38，通过/失败/取消/跳过为 38/0/0/0，进程退出 0，总耗时 784201 ms。原复杂 APP17-I01 同一次回放实际运行约 303 秒，覆盖自定义模板/向导/会话/模型历史引用/PNG/草稿往返及真实坏 pg_control/外来作者拒绝。`review84-10-final-typecheck.txt` 是本审核实际执行完整 `tsc --noEmit --pretty false` 的空诊断日志，退出 0。

执行环境为 darwin、Node v24.19.0、已安装 PGlite 0.5.8。最终命令为 `node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/unit/application-backups.test.ts tests/unit/application-backups-review.test.ts tests/integration/application-backup-restore.test.ts tests/integration/application-backup-restore-review.test.ts tests/unit/owned-root-files.test.ts`。新增独立顶层测试是 12 项，均保留具体可观察数据/字节/身份/阶段 oracle，不将一个复杂场景中的多个步骤另计数量。

宿主仍需兑现真实权限、业务关闭和隔离语义核验合同，后续主流程还须检查其他启动服务的兼容条件、草稿隔离与权威指针切换。同步 seal 缩小本进程异步窗口，不宣称提供跨进程内核 inode CAS。没有触碰正在运行的 Electron、调用外部模型或用户数据；全部正式顶层用例仍 `not-run`。
