# Windows 目录同步独立技术审核

2026-10-10。只读核对 Windows 技术方案、目录同步实现、相关安全回归、最终 core 原始日志及 Microsoft/Node/libuv 一手资料。本代理未改产品、测试或台账，只新增本审核文件。

当前结论：**目录同步技术方案通过，当前没有未关闭的方案必修项。** 方案已补明 file-export 有效平台参数、unsupported catch 的限定范围及 close 错误优先。推荐按既有 unsupported 能力契约推进；这不是把所有 EPERM 豁免，也不是建立新的断电耐久保证。后续仍需独立用例审核、RED、代码审核和实际 Windows/完整回归。审核绑定当前目录同步方案 SHA-256：`d00f7b2fd7b00145740da3009540465a15845231b9d3ce608b6976f5742dff8c`。

## 初审必修项关闭

`FileExportOptions.platform` 已存在于 `desktop/main/file-export.ts:15`，当前同步过滤在第119行使用 `options.platform ?? process.platform`。`tests/unit/file-export.test.ts:101–113` 的 EX16-12 在其它宿主上也可明确测试 Windows 策略。方案已明确保留该有效平台输入，其他调用仍默认真实 `process.platform`，不会在替换调用时丢失原 API 与跨宿主测试语义。这个输入来自 main 侧选项，不增加 renderer 指定平台能力。

目录身份固定、阶段细分、EPERM/syscall 窄条件和后置 seal 保留，范围合适。新增文案也明确业务hook及身份/路径异常不进入能力例外，close失败覆盖sync例外。实施时下列断言仍是代码审核通过条件，而非可选建议。

## 源码路径与最小边界

| 位置 | 当前策略及应保留的边界 |
| --- | --- |
| `desktop/main/file-export.ts:98,110–129` | 文件 fsync 必须成功；目录已有 handle.stat/isDirectory/dev/ino 验证和阶段分类。替换目录同步段后，保护目标、父/canonical身份及完整字节读后最终授权必须保留。 |
| `desktop/core/work-lease-recovery.ts:82–86,226,239–248,267` | 本地目录 helper 有阶段但缺 handle 身份验证；新 helper 使用原 request.work，保留确认、closed门控、同audit、owner/lock证明、最终立即检查与cleanup-pending语义。 |
| `desktop/core/root-relocation.ts:139–145,250,298` | 当前 helper 未区分阶段、未 stat handle，旧 EBADF 豁免不迁入。receipt/pointer CAS、原 bootstrap 与控制文件证明、host/cold/owner检查、读后assertCurrent继续保留。 |
| `desktop/core/root-authority.ts:43` | application恢复使用的独立 helper，同样需改为固定root身份和阶段策略。实际调用在 `application-restore-activation.ts:82,105`、`main/application-restore-request.ts:192`、`main/application-restore-layout.ts:58,73`，不改这些业务授权状态机。 |
| `desktop/core/root-ownership.ts:132–141` | 当前 Windows 直接返回。备份/冷源拷贝/通用迁移多数经此路径，因此不能把所有相关失败归因为这个 helper 的 fsync。保持本轮不扩展此实现与退役备份业务的边界。 |

新增共享 helper 与上述四处同步调用替换即可；不修改正式协议、UI、renderer权限、全局错误包装、备份入口或数据库身份判定。`versioned-store.ts:14–18` 等既有 Windows 跳过策略不顺带扩展。

## 判断依据与能力契约

本机 core Node 实际为24.19.0/libuv1.52.1。该版本 Windows O_RDONLY 转为 FILE_GENERIC_READ，fsync 调用 FlushFileBuffers；Microsoft 要求该 API 句柄具备 GENERIC_WRITE。结合已报告的真实普通目录 open/stat成功、只在fsync抛EPERM，能推断当前只读句柄存在已知 API 能力限制，适合按原允许 Windows unsupported 的契约分类。[Microsoft FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)、[libuv1.52.1 fs.c](https://github.com/libuv/libuv/blob/v1.52.1/src/win/fs.c)、[Node24.19.0内置libuv](https://github.com/nodejs/node/blob/v24.19.0/deps/uv/src/win/fs.c)。

libuv同时把 ACCESS_DENIED 和 PRIVILEGE_NOT_HELD 映为EPERM，所以 **code/syscall单独不足以证明目录真的耐久同步成功或所有权限正常**。新增例外必须同时绑定真实Windows策略、helper自己按只读方式打开的句柄、stat已验证同一原目录、phase=sync、code=EPERM、syscall=fsync；不采用错误消息字符串匹配。[libuv Windows错误映射](https://github.com/libuv/libuv/blob/v1.52.1/src/win/error.c)。

这里可不新增 native addon，因为处理的是既有 unsupported 能力契约。若未来要求证明目录项在断电前已耐久提交，需要另行评审具备正确访问权的原生操作及目标文件系统实证；不能把本次例外当作这种证明。当前libuv的rename只用MOVEFILE_REPLACE_EXISTING。Microsoft的MOVEFILE_WRITE_THROUGH说明并不能被泛化成当前Node rename已经有该保证；卷级刷新需要权限，也不属于本次最小修复。[Microsoft MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw)。

## 必须保持的安全与测试断言

- 复制/固定传入的原 `{path,device,inode}`，不从替换后的路径重新学习授权身份。进入、handle.stat后、关闭后核对绝对canonical路径、非symlink目录和dev/ino；实际句柄必须是同一目录。授权校验失败只抛固定安全错误，不能落入unsupported过滤。
- phase应紧贴真正的open/stat/sync/close操作。`beforeDirectorySync`等业务hook留在调用层，不能因hook恰好抛带EPERM/fsync字段的对象而获豁免。新增例外不接受缺syscall、其他syscall、未验证目录或普通文件句柄。
- 始终关闭已打开句柄，close失败不得被sync能力例外覆盖。open/stat/close的EPERM，任何EIO/EACCES/ENOENT/EBADF均失败；新条件在非Windows也失败。原明确允许的open:EISDIR、open/sync:ENOTSUP/EOPNOTSUPP/ENOSYS、sync:EINVAL按原分支分别测试；相同错误出现在stat/close不得获得豁免。
- 所有普通文件write/fsync/close、rename、完整长度/hash/revision/nlink读取和外来替换拒绝仍为必要条件。例外只涉及目录flush能力，不能让文件fsync的EPERM成功、将失败保存ACK改成成功，或删除未知/外来临时数据。
- 同步阶段新增await不能进入原同步CAS与rename之间；保持最后业务seal、完整控制字节/身份CAS及同步rename原顺序。同步后再次执行原owner/host/cold、guard、同audit/文件证明与读后seal；进入同步后发生取消、父目录/控制文件/目标替换仍不能获得成功ACK。
- lease恢复必须在任何owner/lock删除前取得原audit seal，probePid的EPERM/EACCES/EIO仍为OWNER_UNCERTAIN；sync例外不能被复用到PID判断、冷源读权限、数据库状态或锁清理。已提交后的不确定失败继续以现有durability-unconfirmed/cleanup-pending包装，不因文件存在即成功。

现有反例包括 file-export 的异步最终字节读取后父目录替换、RL98 pointer目录sync期间目标/原journal/receipt替换、RL31取消/外来pointer、WL19-04 PID权限错误及WL19-24 open/close故障。新增用例要保留并补覆盖相同攻击经过EPERM能力分支的情形，不能只验证happy path。

## 全部 core 失败分布

独立解析 `core-bounded-final.log` 的TAP诊断：123个 `testCodeFailure` 对应下表，另11个timeout取消记录不计入123。134条顶层not ok不应误称134个fail。

| 实际错误code | 数量 |
| --- | ---: |
| ERR_ASSERTION | 52 |
| DURABILITY_UNCONFIRMED | 27 |
| AUDIT_DURABILITY_UNCONFIRMED | 22 |
| APPLICATION_COLD_SOURCE_UNREADABLE | 8 |
| HANDOFF_IO_FAILED | 7 |
| ERR_TEST_FAILURE | 4 |
| EEXIST | 1 |
| ENOENT | 1 |
| RELOCATION_NOT_COMPLETED | 1 |

失败集中于cold-source17、root-relocation15、work-lease-recovery14、relocation-startup10、handoff9、root-authority7等文件。错误包装和连带assertion不足以归因，不能宣称修目录sync就必然解决123项。

已确认的不同路径：8项cold-source unreadable栈在 `application-cold-source.ts:153–154` 的POSIX读/搜索位判断，发生在目录同步前；draft-journal断言实际mode438与期望384不同；packaging路径断言用斜杠后缀匹配Windows反斜杠；macOS inspector夹具先被真实宿主gate拒绝；avatar读取出现“Missing expected rejection”；模型配置仍有false/true行为断言。它们需分别定位、审查与验证，不以本方案吞掉、跳过或提前改台账。

对后续cold-source建议的独立判断：仅在Windows不把POSIX execute位当目录可遍历证据，保留read位、真实readdirSync/子项lstat-open读取和原identity/version/seal，属于合理的最窄平台修正；所有真实EPERM/EACCES/EIO仍失败，不捕获后继续发proof，非Windows的read/execute拒绝继续保留。它修正底层文件系统语义，不恢复已取消备份UI或新入口，本身没有取消范围冲突。不过它超出当前审核绑定的四处目录同步范围，应在技术方案明确补充、独立用例审核和RED后另行实施；当前通过结论不冒充其实现/测试已通过。

本审核是技术范围审核，未执行新RED/GREEN，也未把Windows模拟分支或历史相同计数当作正式多平台、无新增失败或全量通过证据。
