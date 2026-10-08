# 第103批独立审核：第36批整应用恢复入口合同

日期：2026-10-08。审核者未编写本合同或生产实现。本轮只审文档，未修改生产、操作恢复入口、执行PG或授予35/36源码PASS。

最终结论：**补充合同PASS，可按此合同进入实施**。首审发现的两项P1及两项P2已逐项修订并完成独立定向复核，没有未关闭的合同阻断项。此结论只确认技术方案第5节的实现前补充可执行，不授予35/36源码、GUI/原生流程、两平台或531正式验收PASS。

审阅对象为 `docs/evidence/implementation-36/application-restore-entry-contract.md`；首审为45行，修订复审为59行/12,106字节，最终SHA256 `bafa049560ebc10f14424bd2ddfb738b425e3b01a6121f6699634b994c1895cb`。定向对照 `docs/04-technical-design.md` 第5节、第23批技术审核、第35批activation合同/API说明，以及第78/81批两checkpoint/关闭交接审核。复审还只读核对第17批`application-backup-contract.md`的真实闭根复制/mandatory verifyCaptured边界与第22批在线引擎导入后副本边界；没有读取本批生产实现或运行测试。第35批核心说明明确“现存损坏闭根”尚未实现，本合同的source union属于后续新增范围，不以旧GREEN或旧freeze证明完成。

## 首审问题与要求（保留原发现）

| ID | 位置与缺口 | 要求的合同修改与可观察断言 |
| --- | --- | --- |
| E36-01 · P1 | 第15、19、27行要求完整退出后才运行冷producer、不得开源数据库，同时健康分支依赖真实verified恢复前快照，但没有规定它在哪一阶段产生。正常入口若在最新草稿/设置flush前创建快照，最终闭根会与其不一致；若冷worker才尝试生成，则可能重新打开原源库。已有较旧备份不能代替当前最后状态。 | 明确健康快照由仍具合法源引擎lease的原工作进程在暂停新增写入、完成renderer与元数据flush、排空任务/目录/备份后生成；其完整物理生成和校验必须完成，才允许持久armed交接、关库/session与旧PID退出。如为闭库阶段生成，须明确不打开源引擎的独立生产者及其证明，不能笼统复用健康backup API。冷worker仅重新读取并验证真实快照、最终闭根与交接记录；无法证明一致则保持冷态或进入另行定义的closed-source保留，不重开源库。TDD注入“快照后最新draft/settings变更”“快照IO未结束就关闭”“旧快照/最终闭根不匹配”：不得activate、不显示已保留最新状态；冷producer的源DB open计数始终0。 |
| E36-02 · P1 | 第17、21、23行没有交接持久状态机及准确的重启规则。“缺失…进入恢复状态”未区分正常无交接启动与有pending证据而请求丢失；“旧worker退出”只证明物理生命周期结束，不证明receipt/pointer未提交。旧内存能力丢失后，不能从armed/executing JSON再次制造原能力或用户确认。 | 写明有界交接文件位于固定bootstrap，身份/字节/revision和目录grant绑定字段、单飞控制、原PID退出的受信witness，以及prepared→armed→executing→activated/unknown/cancelled的准确写盘点。prepared不能自动执行，armed只能由新冷worker本次受信操作消费一次；executing没有完整结果的重启只读inspect并显示需检查，不能再次prepare/reseal/activate或回旧编辑器。无pending证据且交接不存在才走正常启动；已有交接/保护/历史而必需记录缺失、篡改、未知阶段必须冷态阻断。明确取消/worker崩溃/退出在提交窗口同样按unknown处理，不把“worker已死”当作安全取消；只读完整控制链可确认已提交并冷启动，未提交审计不重建确认权。TDD在armed写后、executing写后、receipt落盘后/pointer前、pointer后/fsync前、ACK丢失时杀进程重启：新producer/activate次数0，业务准入保持关闭，旧草稿不再flush。 |
| E36-03 · P2 | 第9、28、29、33行对物理失联、存在但不可读/身份变化、数据库损坏、控制记录损坏没有分类边界，也没有明确expectedAppId的可信来源。任一“打不开”不能被映射成currentRootAvailable=false；损坏root marker或pointer时不能从选中备份反推它属于原应用。 | 规定入口先只读核对原指针及完整控制链：ENOENT/ENOTDIR或可证明原identity确实不可用才归失联；路径被外来identity占用时，不能把它认领为原源或复制/修改它。现存坏DB及可证明原identity的损坏受管文件走closed-source；EACCES/IO/不明归属保持需检查，不跳过字节。expectedAppId只来自可验证的原权威控制证据，来自备份的appId仅用于比较。source union明确healthy/missing/closed-source及其各自私有证据；boolean不可独立授予降级权。若当前draft journal字节可保留但语义损坏，明确是阻断启用，还是新增可导出的opaque保留协议并另审；禁止以null绕过当前草稿。TDD分别覆盖旧路径被外来目录替换、权限错误、坏marker、坏pointer、坏journal和同名外来备份：没有伪空源/健康snapshot或不具完整证据的指针修改，外来目录保持原样。只有原控制链仍有效且失联证据、备份、候选和本次确认完整时，才允许真正失联分支启用。 |
| E36-04 · P2 | 第19行只说“预定义命令”，第37行只说就绪前安装barrier，没有将普通/恢复窗口IPC及ACK前业务准入写成闭合清单。安装保护文件本身不能证明原缓存未注入编辑器、模型未启动；第二checkpoint“严格更新”应准确继承35的双revision与真实receipt要求。 | 列出普通窗口仅select/start/cancel/status及草稿精确ACK等语义命令、冷恢复窗口仅native选择/continue/cancel/inspect/exit等命令，实际实施可调整命名但必须严格schema、当前main frame/window/session绑定、单飞；不增加任意path/SQL/core-proof/confirm输入。protected bootstrap覆盖用户restoreLastSession设置，旧缓存按惰性恢复项显示，不发布可编辑/可执行的业务bootstrap直到两份真实DraftJournal检查和精确ACK完成。第二份磁盘revision与clientRevision均严格高于第一份，两个checkpoint均包含全量current/backup/旧provenance。旧owner/token/receipt、遗漏保留项、第一份receipt冒充第二份、ACK丢失均保持保护；关闭/备份/迁移等待整个真实flight。复用现有RecoveryDialog/CloseCoordinator/DraftSession，不另造工作台或模型恢复队列。 |

E36-02允许使用与第35批相符的其它状态名称，但必须规定以上可观察效果。持久请求、receipt和source回执都仅是待核对数据，不能重建内存capability；冷worker内部的每次实际文件写入和最终CAS仍须同步核对main共享撤销单元、稳定实例锁及本次owner。文件/目录fsync失败、已写但未知结果不能用按钮“重试”隐藏成新activate。

## 修订定向复核

| ID | 最终合同位置与关闭依据 | 状态 |
| --- | --- | --- |
| E36-01 | 修订第17行采用原关闭后的冷态`ApplicationBackups.create`，assertClosed证明完整旧PID/worker/engine/session结束；精确闭根字节复制→独立候选verifyCaptured→实际关闭/封口/fsync→verified，最后与源再核对。只有隔离候选引擎可打开，源DB open始终0；captured失败不伪称verified。此为首审允许的独立闭库生产者方案，与第17批合同一致；不采用旧在线导入副本或flush前快照。 | 已关闭 |
| E36-02 | 修订第21–25行规定固定bootstrap、有界单飞、精确file proof/CAS/fsync与真实旧PID witness；prepared不可自动执行，armed在完整闭库后落盘，冷进程一次消费为executing并在本次worker内产生新能力。提交窗口/worker异常统一unknown；executing/unknown/activated重启只读核对receipt+pointer，不重复prepare/reseal/activate或旧flush。完整提交与两checkpoint后分别activated/consumed；正常无pending与必需记录缺失已区分，弃用/再次尝试必须另有受信协议。 | 已关闭 |
| E36-03 | 修订第39行规定appId来自原authority链；备份仅作比较。真实失联、外来identity占位、EACCES/IO/不明归属、坏pointer/marker/catalog/journal分支明确；不能把可证明仍存在的损坏原根传false，不能以null丢弃坏journal。strict healthy/missing/closed-source各需私有证据，foreign目录不认领或读写。opaque坏草稿是后续另审协议，当前保持阻断并保留字节。 | 已关闭 |
| E36-04 | 修订第51/53行列明普通与冷恢复窗口的有限语义IPC，当前main frame/window/session/nonce与单飞/撤销必检，confirm只来自main原生对话框。protected bootstrap覆盖restoreLastSession、完整两checkpoint+精确ACK前不发布可编辑/可执行业务，所有原snapshot惰性保留，双revision严格递增；旧token/遗漏/旧receipt/ACK丢失保持保护，并复用原UI/DraftSession/SaveCoordinator。 | 已关闭 |

既有备份容器、健康恢复前包、目标候选、verifyCaptured临时候选和closed-source副本在实现时仍须各按角色核对原生授权/私有所有权与不重叠条件；第17批备份验证父目录须独立且为空，不能让新包占用稍后仍要求为空的目标父目录。此为已有目录合同的实施约束，没有新增审批步骤。对unknown旧尝试的弃用协议尚未实现时，合同明确保持冷态检查/退出，不以再次恢复按钮伪造可重试能力。

## 已符合的边界

- 普通入口复用已有备份与草稿恢复对话框；根失联/坏库走独立恢复窗口，定位仍受第33批原物理身份限制。原生选择取消不提交权威指针。
- 第15、19、21行要求完整旧Electron PID退出、独立非持久session、固定bootstrap缓存与同一个冷worker中的prepare→draft retention→reseal→activation。producer能力不经过RPC/JSON克隆，main撤权同步共享单元，并等待真实IO/物理退出。
- 第31–33行严格区分closed-source和健康备份；有界库存、普通文件/空目录/缺失项、symlink/特殊/多链接/读取变动拒绝、副本与原源再核对、私有source proof及最终同步seal方向成立。未知文件不删除，原源不修复、不初始化，完整性未知时不启用。
- 第23、37–39行保留原根和副本，unknown冷态检查，不重复activate；新的正常进程采用APPLICATION_RESTORED，两checkpoint及完整metadata gate，原snapshot中的请求/批准/队列只作为惰性数据。新的合法保存不会被旧candidate tree永久散列限制。
- 第43–45行区分TDD、独立审核、controlled picker/local model、真实两平台原生入口与531正式用例，没有借文档宣称实现或用户验收通过。

本轮已仅复核上述合同差异，没有运行PG或全站构建。后续35/36生产代码、源union扩展、实际Electron生命周期及两平台正式验收仍须分别审核和举证；本合同PASS不改变这些状态。
