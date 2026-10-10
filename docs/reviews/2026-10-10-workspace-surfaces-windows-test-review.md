# Windows 目录同步测试方案独立审核

2026-10-10。初审时产品尚未修改；随后只读复核两个新增测试文件及主代理保存的完整 TAP。审核过程没有修改产品、测试或断言。完整浏览器回归另按授权运行并保存独立证据。

**最终测试源码结论：当前用例范围充分，原初审的关键负例边界已补齐；最终专项 TAP 为 37/37 通过。** 不存在需要跳过或削弱原断言的测试方案阻断项。已逐项核读最新 TAP，确认 helper 的相对路径负例与 WDS-08-race 均在该 37 项集合内，fail/cancelled/skipped 均为 0。完整 core/browser 与实际目标系统验收仍须另存结果。本结论不是产品 code review 或“所有测试通过”。

审核输入：[技术方案](D:/Projects/xaanink-desktop/docs/reviews/2026-10-10-workspace-surfaces-windows-plan.md)、[测试清单](D:/Projects/xaanink-desktop/docs/reviews/2026-10-10-workspace-surfaces-windows-test-cases.md)、[公共入口测试](D:/Projects/xaanink-desktop/tests/unit/file-export-directory-sync.test.ts)、[helper 直接测试](D:/Projects/xaanink-desktop/tests/unit/directory-sync.test.ts)、[最终 37/37 完整 TAP](D:/Projects/xaanink-desktop/docs/evidence/workspace-surfaces/windows-directory-sealed-37-final.log)。早期 36/36 日志保留历史地位，不替代最终集合。

## 已充分的部分

- WDS-02 从真实 FileExports.save 出发，仅注入已打开目录的 sync 异常；目录、普通文件写入、文件 fsync、rename、读回与散列均真实。正例期望完整 saved receipt，适合证明当前业务行为失败；无需用缺模块错误替代 RED。
- 现有阶段矩阵明确区分 open/stat/sync/close，EPERM 缺失或错误 syscall 拒绝，文件 fsync 另测，不扩大到任意 EPERM。矩阵还断言已打开句柄只关闭一次，open 失败没有虚构关闭。
- 目录在 sync 时被替换仍拒绝 ACK，外来文件原样保留；普通文件 fsync 失败保留旧文档。能力限制例外不能授权删除、回滚或确认。
- 非 Windows 选项属于分支测试；恢复历史 runner 默认 120 秒不修改单例显式期限；保留原失败、取消与人工终止记录。这些边界正确。

## 初审要求记录（后续源码复核如下）

1. **共享 helper 的独立目录身份负例必须实际落地。** 清单目前只承诺实现后补充。测试应覆盖 pre-open 原目录被替换、等待 open 时路径被替换、handle.stat 非目录或不同 dev/ino、sync 后及 close 后路径被替换。还应覆盖传入非绝对或非 canonical 路径、symlink/junction，以及普通文件 masquerading as directory。每项断言失败、sync 是否被调用、已打开句柄关闭一次、外来目录/文件未被改变。导出外层的 post-check 不能代替 helper 的自身验证，因为 root-authority 等其他调用方依赖它。
2. **补错误组合与完整阶段拒绝矩阵。** 特别是 sync 抛可豁免 EPERM/fsync，随后 close 抛 ENOTSUP/EINVAL/EPERM；结果必须失败，不能因第一个异常可豁免而忽略关闭失败。把原支持代码 EISDIR/EINVAL/ENOTSUP/EOPNOTSUPP/ENOSYS 放到不支持的 stat/close 阶段逐项拒绝，EBADF 的 open/stat/close 也拒绝。当前代码只测试 stat EINVAL、close ENOTSUP/ENOSYS 和各阶段 EPERM，尚不足以证明所有阶段门控。
3. **补 darwin/linux 原 unsupported 分支的完整矩阵。** 现有源码仅覆盖两个平台的 EPERM/fsync 和 darwin/open/ENOTSUP；清单 WDS-06 声明的其他原 unsupported 错误仍待执行。只能称模拟分支通过，不能称实际 macOS/Linux 文件系统通过。
4. **确保全部返回路径后的清理与保护断言。** WDS-08 应明确无 owned 临时残留；WDS-07 及 helper 身份负例保留外来内容和原已写字节。保留既有 owner、protected target、audit seal、取消/关闭门控、完整字节读后 seal 原断言，并重跑四个真实调用者相关用例。不要为了调用次数适配而取消这些行为断言。

上述为初审时的缺口记录，后续源码已补，不应再当作当前未完成项。实际 Windows Electron 导出与最终 bundle 验证仍应另存证据。目录能力限制例外不构成目录 fsync 成功或断电耐久性证明。

## 后续测试源码复核

| 初审边界 | 当前实际测试与判断 |
| --- | --- |
| pre-open 输入和身份 | helper 第16行的同一矩阵拒绝相对路径、过期 inode、非 canonical 路径、真实 symlink/junction 和普通文件，断言没有 open、普通文件保持原文。充分。 |
| 等待 open、sync、close 时置换 | helper 第27行在三个阶段实际 rename 原目录并创建外来内容，断言 DIRECTORY_CHANGED、打开句柄关闭一次、open 时置换不执行 sync，外来内容原样保留。充分。 |
| handle 身份先于 sync | helper 第44行模拟真实 handle.stat 后的异 inode 和非目录结果，断言没有 sync、关闭一次、拒绝成功。充分。 |
| 可豁免 sync 加关闭失败 | helper 第57行 sync 为 EPERM/fsync，随后实际关闭并抛 ENOSYS/fsync，最终必须抛关闭错误。不会因前一异常可豁免而忽略 close。充分。 |
| caller identity 异步修改 | helper 第67行在实际 open 后修改调用者 root，仍只处理已固定的原目录，验证私有 identity 副本。充分。 |
| 阶段错误与平台矩阵 | FileExports 第34行覆盖 open/stat/close 的 EPERM（包括错误带 fsync 的组合）、stat/close 的所有旧能力码、sync 的 EIO/EACCES/ENOENT/EBADF，并验证两平台所有旧能力限制仍拒绝。代码与阶段两个独立维度均有正负证据，不能用原宽泛 EBADF 例外。充分。 |
| 文件同步与清理 | WDS-08 保留旧文并明确只剩旧文件；新增 WDS-08-race 在真实异步 lstat 返回后置换临时文件，要求外来内容、旧文和被移走的原 owned bytes 都保留，并断言注入实际命中。充分。 |

所有 mock 均有明确 fs 操作注入边界，真实写入、文件 fsync、rename、读回、目录和内容检查保留。平台选项只证明分支条件，不是原生 Darwin/Linux 验收。新增测试源码现有 10 个顶层用例，与原租约 27 项组合实际执行 37 项，全部通过（完整 TAP 第225–230行）。相对路径现从 fixture 的 base 计算，确保 Windows 跨驱工作目录不将它变成绝对路径；原相对路径拒绝断言没有改变。

本次复核时 SHA-256：helper 测试 `2b73eb9ea513a16f7f7df35f369a4b376184944e064ee9480b22bf8a8693d0a2`；FileExports 测试 `b555f6285121682bd197fb3705141808384a5bb751f4f868a5a41d61e93738f6`；37 项 TAP `e7cd72d3f2b058be878853fd7eefaacddd842e8794923723b6e0ff4b1a19bd40`。日志有完整测试结果，未包含启动时源码散列；上述是独立复核时的磁盘身份，不冒充 runner 启动快照。

## EX16-15 原生 Windows 权限夹具方案复核

原 Unix chmod(0500) 在 Windows 未构造创建文件拒绝。允许将该单例的 Windows 分支改为新 mkdtemp 目录的真实 ACL 拒写；Unix 分支和原 failed、EXPORT_WRITE_FAILED、原文保留、无临时残留断言均保留。只作用于已核验位于 tmpdir 且带固定测试前缀的隔离绝对 root，使用 execFile 参数数组运行 whoami /user 取得当前 SID，以及 icacls 对该目录添加 WD/AD deny，不带递归或继承参数。真实 wx 创建探针必须先得到 EPERM/EACCES，否则用例失败。

[原生探针](D:/Projects/xaanink-desktop/scripts/probe-windows-directory-acl.mjs)及[执行结果](D:/Projects/xaanink-desktop/docs/evidence/workspace-surfaces/windows-acl-probe.log)已证明本机实际 EPERM、撤销 ACL 与目录删除；测试方案充分，可以按此范围修改夹具。实际用例需在添加 deny 前核路径，finally 撤销本次 deny 后清理，无论探针或业务断言如何结束均执行。探针不是 EX16-15 完整业务用例结果，后者仍需原断言执行。

Microsoft 文档规定 WD/AD 分别涉及目录添加文件/子目录；/deny 也会从同 SID 的显式 grant 移除相同权限，/remove:d 仅删除 deny。因此该流程仅适用于本次新建隔离 root，不可复用至用户目录，不等于恢复任意已有 ACL。[icacls 官方说明](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)、[whoami 官方说明](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/whoami)。此证据是 Windows 真权限边界，无 mock，不声明 macOS/Linux 原生验证。

## 完整浏览器回归执行结果

按原 runner 执行 `node scripts/check-workspace-surfaces.mjs browser browser-windows-directory-final`，Node v24.19.0、Windows、Chrome、并发1，原30个 browser 文件未筛选用例、未修改断言或期限。2026-10-10 08:50:59Z 启动，08:58:49Z 正常退出0，TAP 219/219 pass、0 fail/cancelled/skipped/todo，duration 470543ms。[完整 TAP](D:/Projects/xaanink-desktop/docs/evidence/workspace-surfaces/browser-windows-directory-final.log)、[命令与统计](D:/Projects/xaanink-desktop/docs/evidence/workspace-surfaces/browser-windows-directory-final.json)。log SHA-256 `00758e4b44c4a87833169f519f50414e0e1bc17994beac415458d63fa8b0edb9` 与 JSON 一致。

此前四个导出正例 EXB16-01/02/05/07 和截图超时的 MUI73-10 在本次完整集合实际通过，旧 214/219 失败记录仍保留。导出测试使用真实 Web 转换器、菜单、FileExports 与隔离真实文件系统，受控的是源 API 及 Electron IPC/picker；通过不等于原生 SaveDialog 验收。所有其他 browser 用例仍遵循各自既有夹具边界，219 项结果不替代完整 core、真实29类业务或跨平台验收，也不能将人工终止及历史取消改为通过。

## 其他失败的范围

目录同步方案有当前导出和租约恢复的真实修复价值，但不足以解决全部历史核心失败。冷源 POSIX mode 检查、头像叶子 symlink 读取、ESM/路径/权限夹具和原生 macOS 验包边界另见[Windows 失败来源调研](D:/Projects/xaanink-desktop/docs/reviews/2026-10-10-workspace-surfaces-windows-failures-research.md)。该调研不授权扩展产品、安全修复或复活已退役备份功能；平台外或退役用例不能改写成当前原生业务全部通过。
