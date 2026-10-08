# 76 · Workspaces 实际恢复集成独立审核

日期：2026-10-08。审核者：ui_revision_review。主代理实现；审核者只写独立测试、记录与证据，不运行Electron，不修改生产实现。

## 结论与范围

**限定 PASS**。本轮三处实际失败已修复，新增9项真实FS/PGlite检查与20项相关回归最终合跑29/29通过，fail/cancelled/skipped/todo均0、exit0；76范围类型检查exit0、空诊断。全量类型检查当次有其他在途范围诊断，未称全量通过。

范围：`desktop/service/workspaces.ts`的prepare/cancel/activate与generation打开、实际业务retainer/关闭/解锁；`workspace-storage.ts`的独立保护标记；补充的`cold-work-preservation.ts`及`work-storage.ts`的可选closed-source来源字段。该扩展只在无活跃作品连接的情况下保留原始字节，不把损坏/缺失源当作可打开的健康数据库。本轮不批准main/IPC/UI激活接线、原生窗口、Windows或未来保留策略。531条正式用例仍 not-run。

作者`workspaces-restore-frozen-v1.json`独立只读核验：6份源码/作者测试、9份依赖、7份证据全部SHA匹配；按其声明Python默认`json.dumps(sort_keys=True)`算法重算aggregate，匹配`477a7d9d9db1263f4ef926baca16ae576b846c4f636260caa204a91dfb06ee09`。root-ownership依赖中的backup-plan.json迁移allowlist属于相邻main范围，指纹记录不等于本轮批准该调度状态接线。第75轮最终v2也已只读核验，6/7/11份记录及aggregate全部匹配；本轮新增schema没有改写其历史清单与报告。

## 实际问题与修复

| 编号 | 独立真实失败 | 修复与复验 |
| --- | --- | --- |
| WR76-01 | 实际作品writer lock内新增未知子目录/文件，正常close用recursive rm连同未知字节一起删除。 | release只允许自己的owner.json，发现未知项目拒绝并保留；移出未知fixture后显式close可重试，cold reopen原作品正常。owner创建失败路径也只尝试移除已验证的空目录，不递归删未知内容。 |
| WR76-02 | 当前database已缺失，但真实备份能prepare出已验证候选；activate仍先connect旧库，无法恢复。 | 无活跃slot时只取得作品lease，不打开旧engine；把原database/assets按目录清单与散列复制到独立保留目录，缺失项目明确记录。候选成功启用，原缺失状态及外部保留证据不变；普通文件形式的损坏database也逐字节保留并可冷启动新代。 |
| WR76-05 | release已unlink owner，rmdir被实际FS故障注入拒绝；故障撤除后再次close因owner ENOENT永久失败。 | lease记录ownerRemoved，重试仍核同一目录身份与空目录，仅移除此目录，不能删除新出现的未知项目或接管替换lease。正常close及已经commit后的激活解锁失败均可显式重试。 |

初始`review76-lease-cold-red.tap`两项实际FAIL/exit1；`review76-unlock-canonical-red.tap`一项实际FAIL/exit1。保存原始RED，没有用重写失败日志代替实跑。

另外保留夹具错误，不计产品缺陷：两份unlock早期尝试以`/var`路径匹配而实际授权路径是`/private/var`，未命中故障注入；修成record.path后才捕获WR76-05。`review76-generation-cas-attempt.tap`及作者restore-20中的active-cancel拒绝实际正确，仅正则“已启用”不匹配“已经启用”，已将测试收敛为拒绝语义。作者cold首次缺模块RED不是本审核的行为RED，canonical夹具失败也没有计为产品问题或称整个author尝试全绿。

## 新独立行为覆盖

`tests/integration/workspaces-restore-76-review.test.ts`9个顶层用例均创建真实隔离作品、使用原Prisma schema/PGlite及真实磁盘文件，不使用私有slots状态替身：

- 01/05：未知lease内容不删；owner删除后的目录移除失败能重试，最终重新打开原作品。
- 02/07：cold缺失与普通文件损坏源都能通过已验证备份恢复；closed-source回执明确缺失状态，原损坏文件inode/字节、附件字节、空目录及受管范围外的原笔记不变；新代再次冷启动正常。
- 03：仅对真实engine的公开close注入故障，实际捕获恢复前备份后关闭失败；pointer/owner不改，禁止继续run，故障撤除后显式close再冷启动读到最后原稿。
- 04：真实retainDatabaseTask保留后台数据库；并发两次activate均拒绝，pointer不变，close也不越过任务。后台最后写入并释放后同候选可启用，实际解包并打开恢复前备份读到最终保存。
- 06：两个候选同revision，启用A并继续写后，旧revision的B不能替代A且不会额外创建quiesce备份；取消active A拒绝，不影响当前数据；未启用B可取消。
- 08：只注入commit之后的真实rmdir失败，激活Promise拒绝但磁盘新pointer保留；run门控，显式close完成后冷启动读到新代，不能回退旧库。
- 09：只对closed-source目标文件open注入写失败，激活不改原pointer和原字节；撤除故障后同一候选可显式重试启用，来源为closed-source。

故障注入仅控制公开PGlite.close或精确受管FS路径，真实SQL、export/import、pointer rename、receipt、目录身份、lease、再次打开仍由实际模块执行。并发与取消是公共方法级行为，没有把它们称为OS中断、进程强杀或用户窗口交互。

## 代码判断与保护边界

prepare/cancel在真实work lease内运行，已有slot在操作期间pin active计数；没有slot时取得独立lease。普通打开不偷取活跃/其他host/陈旧锁，陈旧恢复仍要求显式流程。activation同步登记作品maintenance，拒绝新run和重复激活，检查retained task后才处理来源；指针revision/owner/候选证明仍由已审WorkStorage在写前和提交后复核。

活跃连接先捕获最终健康备份，再await Prisma断开与engine关闭；任何关闭失败保留failed retirement/lease并阻断作品重用。成功或不确定提交按实际pointer权威处理，解锁失败也保留重试对象；blocked不会因finally静默释放writer lease。新连接通过pointer解析generation，候选目录身份须匹配；独立required标记存在时丢失pointer不能回原库或自动创建空库。作者真实集成还覆盖了cold reopen及pointer丢失/恢复后的authority。

cold无slot分支只持lease，按当前pointer来源保留closed database/assets，不试开损坏engine、不伪造健康xxbackup。copy与回执限制普通单链接文件、无symlink，保留空目录及缺失清单；文件读前后身份/大小/时间与散列、源清单前后及目标copy核验，receipt保存后再次验证。每次候选写前/提交后验证还核closed副本；复制失败保留原authority及源字节。`previous.kind='closed-source'`明确区分其ID与健康备份ID，省略kind的旧健康pointer仍保持原schema/checksum，不自动重写旧状态。保留目录不会被本轮清理为未知垃圾。

lease提供本机合作进程互斥和显式stale恢复边界，不宣称抵抗同权限恶意原生进程的任意路径替换。发生关闭/释放故障需要显式重试或外部恢复，不把错误吞掉来开放写入。

已知后续边界：健康preRestoreBackupId当前通过retention1000创建，后续常规自动保留可能删该包；上一代目录仍保留。本轮只证明激活当时的最终备份/authority与close/cold/cancel完整性，没有批准未来retention pin保护，后续备份控制需单独补固定引用保护。没有主进程调度/配置接线、用户恢复确认、实际OS退出/断电、运行中import即时取消或全量桌面验收。

## 执行记录

Node v24.18.0最终相关命令：

```sh
node --import tsx --test --test-reporter=tap tests/integration/workspaces-restore-76-review.test.ts tests/integration/workspaces-restore.test.ts tests/integration/workspaces.test.ts tests/unit/cold-work-preservation.test.ts tests/unit/work-storage.test.ts tests/unit/work-storage-75-review.test.ts
```

`review76-final-related.tap`：29/29、exit0，fail/cancelled/skipped/todo均0，含9项本轮新独立、3项本轮作者（1实际恢复集成、2cold FS）及17项既有回归（9Workspaces，包含原IPC-02目录身份子用例；4pointer；4第75轮独立pointer）。既有用例按实际重跑计入相关结果，不冒充本轮新增，不因原用例名称带DESK/IPC编号而改变正式用例状态。

`review76-scoped-typecheck.txt`：exit0、空诊断；10个76源/测试入口与所有transitive imports参与检查，配置/命令见`review76-typecheck-scope.json`。当次全量`review76-full-typecheck.txt`exit2的6条诊断都在main backup-error事件联合及其他作者图像Response/pollDelay接口，日志保留，没有76诊断，不修改他人在途实现，也没有宣称全量类型检查通过。

`git diff --check`对本轮源/独立测试通过。最终源码、测试及证据以`review76-independent-summary.json`单独记录指纹，不把作者初始或夹具失败日志当最终GREEN。没有修改531条正式用例状态。
