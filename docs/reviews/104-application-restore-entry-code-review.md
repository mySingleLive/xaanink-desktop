# 第36批恢复入口增量独立代码审核 104

2026-10-08；审核者 `/root/application_restore_review`。已完成本文件所列的限定增量审核。第103号为合同审核，第102号只授第35批有限核心结论；均不等于第36批入口或桌面验收通过。

审核者只新增独立测试、证据与本报告，未修改生产源码或作者测试。全部数据来自隔离临时目录，子进程使用测试 Node；没有真实用户数据、模型密钥、远程供应商、PG、Electron 原生窗口、发布操作。

## 当前结论

授予 **helper v2 / request v3 / root-session v1 的限定核心实现 PASS**。四项独立生产反例均保留原 oracle 并在最终冻结源码上复验通过；12个相关测试文件184/184 GREEN，全仓 tsc exit0，51项冻结文件/记录/独立测试运行前后 hash/字节数一致。本结论不授第36批完整入口或桌面验收 PASS；主进程/UI/冷 worker/source union 仍属后续新增范围。

## 实际源码范围

- `src/lib/desktop/draft-session.ts`：第一份实际 receipt 的 checkpoint hook、维护过程中的生命周期检查和冷新会话 revision 下界。
- `src/lib/desktop/save-coordinator.ts`：不改变 payload 时强制更高 clientRevision，共享在途 checkpoint 和非法下界拒绝。
- `src/lib/desktop/draft-recovery.ts`、`src/components/desktop/RecoveryDialog.tsx`：APPLICATION_RESTORED 理由、完整恢复数据的保留及显示文案。
- `desktop/core/application-cold-source.ts`：现存闭库的原始受管字节副本、原物理观察、严格 receipt/private capability 和两种同步封口。
- `desktop/main/application-restore-request.ts`、`desktop/shared/application-restore-request.ts`：固定 bootstrap 的持久交接链、实际旧 PID 退出约束、一次 executing handle、实际 journal/barrier 的双检查点消费。

读取了第103号合同、第36批 entry contract、helper/request API 与各作者冻结清单。helper v1 的29项已逐项独立核对 SHA256/字节数（`review104-13-cold-source-full-precheck.json`），随后 C05 暴露新的反例；该冻结历史保留，不能以这次 hash 一致性授功能 PASS。`review104-11` 仅是25项依赖/日志的初步检查，完整29项结果以13为准。

## 独立发现与原 oracle

| 编号 | 严重度 | 实际触发与结果 | 状态/证据 |
| --- | --- | --- | --- |
| R01 | P1 | 实际旧进程 prepared→armed 并完整退出；新实例发行 handle。原 owner closure 撤销后本应一直 OWNER_EXPIRED，但替换整个公开 `manager.options` 对象可使旧 handle.assertCurrent 通过。冻结初始对象不能固定实例字段。 | `review104-07-request-owner-red.tap` 为真实 RED；作者改为原生私有 host/bootstrap/执行映射/进程身份。审核者保持原 oracle 独立复跑09为3/3 GREEN，10亦 R01 GREEN。 |
| R04 | P2 | 实际 armed 历史附加 schema 合法但阶段不应存在的 execution；重算严格 checksum 和实际 file proof后，新 startup 返回 execute-ready，预期 cold。 | `review104-10-request-phase-red.tap`：3 GREEN/1 RED。作者新增逐阶段字段矩阵和合法字段引入约束；原 R04 在18独立复验 GREEN。这是控制读取语义缺口；未声称真正调用 producer/activate，后续 beginExecution 仍可能拒绝。 |
| C05 | P1 | catalog 作品 path 是实际作品目录的 symlink alias、stored identity 与实际作品一致；native parent 是该实际作品内的空 UUID。仅字面路径 overlap 漏拒，helper 成功把 raw copy 写入作品并发行私有 proof。 | `review104-14-cold-source-alias-red.tap`：4 GREEN/1 RED。作者 v2 钉住现存 catalog 作品 canonical/nonlink/真实身份及持续观察、检查 native containers 祖先物理身份；17独立原5项5/5 GREEN。v1和原 oracle 保留。 |
| R05 | P2 | 实际 prepared→armed 链的 revision 改为2→1，完整 checksum/前驱/file proof仍一致、集合{1,2}连续。read先排序再验证集合，错误返回 execute-ready。 | `review104-18-request-history-order-red.tap`：4 GREEN/1 RED。作者 v3 按 operations 创建顺序和实际 predecessor 链直接核全局1..n，移除排序。原 R05 和作者逆前驱/倒置 operations/跨操作交错三组在21最终独立复跑 GREEN；未声称执行能力被重建。 |

`review104-06-request-red.tap` 是审核者子进程脚本换行转义错误，未运行到产品行为；07修 fixture 后才构成真实 R01 RED。`review104-02-typecheck-attempt.txt` 是独立测试缺 AutosaveController 泛型导致 unknown，已只补类型参数，04全仓类型检查 exit0；不把这些 fixture 错误列为生产缺陷。所有失败输出保留。

## 已运行的独立测试

独立文件分别为 `tests/unit/application-restore-draft-session-104-review.test.ts`、`tests/unit/application-cold-source-104-review.test.ts`、`tests/unit/application-restore-request-104-review.test.ts`，不改作者测试的断言。

| 独立用例 | 真正验证的边界 |
| --- | --- |
| D01 | 多个 revision 下界加入同一实际磁盘 IO，单个 waiter abort 不结束物理写；最终 receipt 超过全部下界；paused 请求 controller 不执行领域保存。 |
| D02 | 非法/溢出/非数值下界在 generation 或 writer 变化前失败。 |
| D03 | writer 更换与实际 journal owner 撤销发生在在途 IO 时，旧 checkpoint 不提交；明确新 owner 的后续检查点保留完整数据。 |
| D04 | 第二实际 ACK await 期间撤销 journal/barrier owner 并 dispose session，core 保持 checkpointed，保留原源和完整惰性恢复项。 |
| D05 | 第一物理 checkpoint hook 失败后，不清缓存、不生成第二 receipt，core 保持 protected。 |
| D06 | 真实保存请求的完整 POST/PATCH/body/approved/queued/staged/scene/comment 等对象跨重复启动与相同 ID 不同值稳定保留；不 verify target、不触发 controller/transport，导出克隆不能修改内部内容。 |
| D07 | 新 coordinator 的相同 recovery payload 从前一实际 clientRevision=30 开始；第一、第二新 receipt 的磁盘/client 双 revision 都严格递增，actual barrier complete。 |
| C01 | validator 精确匹配原 operation/root/pointer；替换公开 callback 不能替代原 private seal。指针文件改变后旧 authority 失效；预先取得的 source-only seal仅检查物理源，不授指针变更权限。unknown 边界替换使封口失效且保留外来文件。 |
| C02 | 实际目标 FileHandle.writeFile 挂起时 cancel 不提前宣称完成；释放真实 IO 后拒绝 proof，目标中途外来 inode 替换与原源字节均保留，没有有效 receipt。 |
| C03 | 原受管 assets/global 目录在 yielded inventory IO 中替换，即使 PNG 字节相同也不重新学习外来身份。 |
| C04 | proof 已发行后撤销原 native closure，替换 host/public callback 仍不能复活原 validator 和两种 private seal。 |
| C05 | catalog 别名的实际作品重叠拒绝；历史 RED，最终 v2 GREEN。 |
| R01 | 真实旧 PID退出后 private executing handle 仍绑定原 native owner；已修复复验。 |
| R02 | 活旧 PID 即使宿主空断言也拒执行；退出后 executing/unknown 的新实例仅检查，克隆不能重发 handle，检查不修改控制字节/成员。 |
| R03 | 实际 phase publish await期间原 owner 撤销，调用者替换 callbacks 无效；flush 等待物理 IO 完整结束且不遗留成功控制记录。 |
| R04 | 阶段与 optional 字段的语义冲突拒绝；历史 RED，最终 v3 GREEN。 |
| R05 | 完整前驱链的阶段 revision 逆序拒绝；历史 RED，最终 v3 GREEN。 |

D组05为7/7 GREEN、初始 C组08为4/4 GREEN、修 R01 后 request09为3/3 GREEN。扩大 C05/R04 后的失败不可被较早的通过数覆盖。`review104-12-cold-and-session-related.tap` 在 helper v1/current session 源码合跑84/84 GREEN，覆盖相关作者与独立组；此结果发生于新增 C05 反例前，最终范围待修复冻结后重跑。

## 必须保留的范围限制

1. 原始闭库 helper 没有接入第35批 producer/activation source union 或新版 authority record。`assertSourceCurrent` 只保持源与副本物理封口；真实 activation 必须另持自己的 fresh/new authority，不能仅凭 receipt JSON 启用候选。
2. request 的 owner/cold/quiescence/worker-settled hooks 在这些单元测试中是明确协议替身。真实 Node 子进程仅证实 old PID 物理存活/退出约束，不能证明完整 Electron main、worker、引擎、session 的排空。
3. 作者 request 的 committed core fixture 为明确 seeded 实际 FS authority，不声称执行第35批 producer/PG activation。审核者没有运行 PG。
4. 两份实际 DraftJournal 回执和 core barrier 可由核心测试验证；真实 metadata gate、protected bootstrap 的全业务惰性、close/reload/第二窗口/renderer nonce/mainframe 绑定仍须接线验证。当前 DraftSession hook 和 APPLICATION_RESTORED 文案没有真实原生 UI 通过证据。
5. unknown/backups/作品只保留原地边界；不能称其内部字节已复制。坏 journal 语义仍拒绝；没有 opaque journal 容错。原坏数据库副本只标 not-verified，不能称健康备份。
6. 尚未进行 MacOS/Windows 原生冷恢复操作、安装验收、全531正式用例或用户逐项桌面验收。代码、冻结 hash、协议单元通过数都不能替代这些结果。

`review104-19-helper-root-prior35-precheck.json` 已独立核对 helper v2 33/33、root-session v1 5/5，无变化；历史第35批113项中 `desktop/main/application-metadata-gate.ts` 当前发生一项变化，是 root 另授权的新 protected-controller/private-flight 增量，超出104限定范围，待后续独立审核。没有恢复或修改该文件。第35批冻结是历史源码快照，不能继续称当前113项全部未变。

## 最终冻结与独立复验

| 冻结范围 | Manifest SHA256 | 独立核对 |
| --- | --- | --- |
| helper v2 | `4c2ad7d4242799506798bdba5966b1d98c0e9672227a7ee41f181a810619b2ac` | 33数组项加历史v1 manifest，共34项一致。 |
| request v3 | `d61eb7c1035cb98199784938a7407779946f3f5ceec6efea775567405a55cc06` | 4 owner文件、4证据、合同和历史v2 manifest，共10项一致。 |
| root-session v1 | `03254d4e76d6036e85812e5bca7426f6633b8f8f1de37760e090bbfd8b3bb99a` | 4源码和1作者测试，共5项一致。 |

`review104-20-final-freeze-precheck.json` 合并上述内容与3个独立测试，去重51项；`review104-23-final-freeze-postcheck.json` 在 tests/types 均完成后再次逐项读取，changed=0，aggregate SHA256=`16928816ccc39c57a244770ee90121db2df624394d58e2f68db7f92ec7035100`，前后相同。

最终运行命令使用测试 Node24、tsx、node:test，12文件含 helper/request/root-session 的全部作者/独立测试，以及 application draft retention/barrier、保存协调器、原 session/recovery 和旧 root migration request。`review104-21-final-related.tap`：184/184、fail=0、cancelled=0、skip=0，10973.423625ms；其中17项独立 D/C/R oracle 全部通过。作者新增阶段全矩阵、实际 committed unknown→两真实 checkpoint→consumed且不可变旧reason保留、三组历史顺序反例也由审核者实际执行通过。该 unknown 流程仍是明确 FS-seeded core authority，并不冒称真实producer/PG。

`review104-22-final-types.txt`：全仓 `tsc --noEmit --incremental false` exit0、无诊断；这是最终限定冻结运行期间的实际检查，不覆盖后续新 delta。PG/native/build/真实供应商/正式531均 not-run。完整两系统入口、source union、保护主进程 controller/metadata 私有 flight 将另行审核，不挪用本 PASS。

第35批旧 manifest 与各失败输出均未覆写。后续授权生产增量不要求当前源码继续匹配其旧历史快照；本报告只证明上述51项在104最终运行窗口没有变化。
