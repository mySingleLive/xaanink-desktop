# 117 · 阶段42 macOS冷锁修复harness差异审核

2026-10-08。结论：**PASS_LIMITED_PHASE42_MACOS_HARNESS_CODE**。最终差异当前无限定范围内的遗留阻断，可开始由获准CUA进行实际冷启动取消、修复两步。此结论仅授harness代码前置审核，不授真实原生对话框、默认数据修复、普通重开、保存可靠性或530项正式验收PASS。

审核者只读脚本、42契约、116报告及被调用的实际lease reader代码，并计算仓库文件散列；未运行脚本、启动App/PG、读取HOME目录实际数据、修改生产源码或harness。作者报告的 `node --check` 成功不是本审核独立运行成绩。所有本轮反例是静态控制流/断言分析，未伪称实际RED/GREEN。

## 固定对象与范围

| 对象 | SHA256 |
| --- | --- |
| 最终 `scripts/acceptance-packaged-macos.mjs` | `10a2bab10b9b1d66ce22610a8e1effe2569c65097df63a6846ae1cc6eaa55059` |
| `implementation-42/packaging-frozen-v1.json` | `d2c4eb91b6183de41b3a5bbe811c99018260d907c50526007632f9d01835a968` |
| `release/package-static-darwin-arm64.json` | `e5870a36058e204ca771977343e9d3351f8e40383e0d31698b70da0715bbb0a2` |
| `implementation-42/global-inbox-lease-contract.md` | `f1d887974d14947b06326fc5c2f31badf541797ab0a615bd48e199bb00bee7bf` |
| `docs/reviews/116-inbox-lease-recovery-code-review.md` | `0553495b740c66e2520a69fabc935430a565ea3ba98865207708289b10c07c73` |

用户39阶段对默认业务根与userData“仅含测试数据、没有真实Key”的直接授权继续有效；本审核没有重新读取这些目录。115报告及原脚本SHA保持原历史，不将阶段42包视为阶段39不变包。42冻结明确662项历史基线中允许两项已审生产变化、另两项新增源码；不宣称662项全部未变。新DMG/ZIP、资源probe与116成绩由原作者/审核者分别负责，117只读引用，不重新执行或加总为native成绩。

初读时冻结pin全零，不能启动；之后实际冻结完成，脚本pin已钉上述真实SHA。首次已pin、尚未修补本轮反例的脚本SHA为 `6064de0a0cd2965b591962236bff0164a7e4d8484c74106d86f3f46c14248164`，仅用于保留静态发现的版本归属。

## 发现、反例与最终读回

| 编号 | 静态反例 | 最终代码处理 |
| --- | --- | --- |
| R01：cold异常可能丢guardian | direct spawn之后save或输入处理抛错进入顶层catch；`application`未赋值，旧cleanup跳过cold child并throw，Node退出后600秒timer也消失，App可能遗留 | catch针对实际owned child标forced/error/非零，精确SIGKILL并等待实际exit。10秒ack未确认时记录错误并继续保留guardian/ownedExit等待，不假称已完成或终止陌生PID |
| R02：repair仅看phase会误收旧/伪审计 | lock已不存在且任意JSON含 `payload.phase: recovered`，或保留旧recovered记录，旧oracle即可通过 | 先核冻结历史基线及允许delta，再在harness中只读导入实际 `observeWorkLeaseAudit`。它严格核schema、checksum、actual fileIdentity、work物理身份、ownerProof；读回bytes后再封口原观察。最终回执额外绑定本次before owner完整revision/base64/hash及lock revision；partial observed绑定旧proof/auditId且revision增加，旧recovered不能复用旧auditId |
| R03：祖先与同bytes替换不能证明原对象不变 | 原tree仅核database leaf，inbox祖先link可先读取外来树；取消仅比bytes可接受不同inode的同内容owner/audit；补identity后，旧 `await lstat → await readFile` 仍可组合旧inode与新bytes | 钉root/bootstrap/inbox/database的canonical、nonlink、dev/ino，读前/后复核；lock存在时须原canonical物理身份，readdir await后再核。metadata使用同一fd的bounded reader，O_NOFOLLOW、nlink/bytes上限、fd与leaf完整revision前后封口；取消比较actual identity、size/hash/absence与原对象 |

这三项限定静态发现均已修复读回。117没有改oracle或源码来迁就实现；没有启动真实反例、故障注入或给予测试数量。文件散列与控制流证据足以作本轮限定代码判断，不能代替运行证据。

## 冷分支已核行为

`--cold-inbox`只允许单个该参数；脚本直接 `spawn` 冻结App的真实可执行文件，App参数为 `[]`。该分支不调用Playwright launch、evaluate、业务IPC或原生dialog stub，不添加testRoot、inspect、测试preload或自动UI动作。它沿用进程环境，不能从空args扩大宣称所有OS环境均为空。首输出明确spawn不证明dialog已出现；窗口与按钮必须由CUA实际观察。

stdin的 `expect-exit=cancel/repair`只登记预期，不能修复锁、关闭App或证明用户点了按钮。cold的harness quit命令被拒，截图依赖CUA。实际child exit才分类：预期已登记、code为0、无signal、未强止；没有预期、错误码、信号或watchdog强止均不是正常通过。600秒watchdog绑定本次真实child handle，关闭输入并记录forced/error/非零，不按扫描得到的PID接管已有实例。

异常分支保持实际进程归属直到退出确认。若OS始终不能确认退出，guardian有意保持pending，不能报告有限时间内已完成清理；停止依赖该运行的后续步骤并保留日志/状态。这项fail-closed行为不构成“已正常退出”成绩。没有实际运行证明所有OS故障必定在600秒内settle。

退出后的成功输出须通过全部cold data断言：

- closed inbox数据库所有枚举的regular文件按相对path/size/SHA与before相同，新增/缺失也失败；单文件256MiB、总1GiB、文件数少于20000，扫描90秒，上限不适用时拒绝本次验收而非漏验或降级；root/inbox/database身份保持，遇链接拒绝。
- 原五项应用元数据及absence状态、identity/size/hash保持；owner/audit的read有实际fd/leaf封口，不能用同bytes替换伪造取消无变化。
- cancel保持原lock目录身份及owner/audit identity与bytes，未写repair成功标记；此断言证明本次前后状态，不能单凭它证明CUA实际按了“退出”。
- repair两次核lock实际不存在，中间strict audit观察与实际文件封口；回执绑定原owner或合法observed上下文及不可复用的审计转换。旧recovered或仅phase字符串不再足够。

`tsImport`只在外部Node harness读取冻结源码；调用的入口仅为只读观察/封口，没有调用 `prepare`、`recover` 或任何实际写入能力，更没有把该import注入App。独立性的限制明确：strict格式检查复用116已审原decoder，本117独立审核新增baseline绑定与结果断言，不称另写了一套独立schema oracle。

## 普通分支与结果限制

普通模式继续Playwright启动真实冻结包、只读诊断及原生产 `app.quit`，沿用115的正常退出分类、45秒总期限、5秒dispatch和操作deadline；没有为cold通过改业务bridge或生产包。普通Playwright调试通道、原生OS交互和物理IME的边界继续按114/115分别记录。

本报告不证明CUA权限已授、真实冷dialog已出现、按钮选择符合预期、旧锁PID确实满足当前修复条件或实际用户数据已修复；这些由产品真实guard和本次运行逐项核实。新child退出、期望flag或clean字段均不能单独记native PASS。读取完整errors、forced/cleanup状态、CUA截图与操作记录、退出后的断言；任何失败保留，不能被后一次正常退出覆盖。

冷修复通过后普通重开、新writer租约、公开业务内容、正常关闭仍是独立后续步骤。没有App再次启动或数据库查询成绩；数据库文件SHA相同也不能扩大为已证明所有业务可用。Windows、其它架构、fresh-install、全部530项以及115未覆盖的网络/资源/OS子进程监听检查仍待各自实际证据。

117仅新增本报告，未改115/116历史冻结或失败证据。脚本或冻结产物再变化时重核相关差异；当前结论允许有限执行，不继承为运行结果。
