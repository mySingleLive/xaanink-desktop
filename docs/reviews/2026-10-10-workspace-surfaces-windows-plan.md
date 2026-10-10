# 完整回归：Windows 目录同步技术方案

2026-10-10。宣纸 UI 第三版已实施，专项 12/12、实际 Windows 39 个检查点通过。完整回归仍失败。本方案只处理阻塞回归的目录同步兼容性，不修改批准配色、不恢复已取消备份功能，也不提升原正式验收台账。

## 实证与一手资料

当前 Node24.19.0 / libuv1.52.1、Electron44.6.0 使用 Windows。隔离普通目录 `open(path,'r')`、handle.stat 成功，handle.sync 抛 `EPERM / syscall=fsync`。既有 file-export、work-lease-recovery、root-relocation、root-authority 的 unsupported 分支遗漏这一已知只读句柄限制。

Microsoft [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)要求句柄有 GENERIC_WRITE。libuv1.52.1 [Windows fs.c](https://github.com/libuv/libuv/blob/v1.52.1/src/win/fs.c)把 O_RDONLY 转为 FILE_GENERIC_READ，fs__sync_impl 调用 FlushFileBuffers；[error.c](https://github.com/libuv/libuv/blob/v1.52.1/src/win/error.c)把 ACCESS_DENIED / PRIVILEGE_NOT_HELD 转为 EPERM。结合实测，推断这里属于只读目录句柄不能执行 FlushFileBuffers，而非证实目录元数据已耐久落盘。

此前已允许 Windows 部分目录 unsupported 错误；采用同一能力限制契约。继续执行文件 fsync、rename 和全部授权/写后完整读取/身份 seal。结果不能被描述成 Windows 目录 fsync 成功或断电保证。不会添加管理员卷刷新、HTTP 服务或 native addon。

## 修改边界

新增小型 `desktop/core/directory-sync.ts`，统一只读目录同步策略，接受已固定 `{path,device,inode}`。进入时、句柄 stat 后及关闭后同步核对绝对 canonical 路径、非 symlink 目录与 dev/ino。open 成功后必须先验证实际句柄是同一目录，才允许能力限制例外；不能把文件 fsync 错误交给此 helper。

明确追踪 open/stat/sync/close phase，始终关闭已打开句柄。仅 Windows、通过目录验证、phase=sync、code=EPERM、syscall=fsync 可增加例外。open/stat/close 的 EPERM、无 syscall 或其它 syscall 的 EPERM、EIO/EACCES/ENOENT/EBADF 均继续抛错。原已明确允许的 open:EISDIR、open/sync:ENOTSUP/EOPNOTSUPP/ENOSYS、sync:EINVAL 保留并逐项测试；stat/close 的相同错误不获豁免。旧 root-authority/root-relocation 的不分 phase EBADF 豁免不迁入。

四处调用只替换同步策略：file-export 用已有 canonical+info，保留有效平台 `options.platform ?? process.platform` 并传入 helper；其余调用保留 process.platform，work-lease-recovery 用 request.work，root-relocation 用 bootstrap，root-authority 用 root。原调用前后 guard、确认、同 audit/文件 seal、关闭门控、授权、保护目录和完整字节读取均保留。root-ownership Windows 原行为与已退役业务不扩展。unsupported catch 仅包围真实 open/stat/sync/close；不得吞掉 beforeDirectorySync hook 和前后身份/路径校验异常，close 失败始终覆盖 sync 能力例外。

目录身份失败继续抛安全固定错误，调用层保留现有 durability-unconfirmed 包装。恢复操作还必须在任何 owner/lock 删除前取得原 audit seal；能力例外本身不授权清理。

## 推进与验收

技术方案独立审核 → 测试用例独立审核 → 先运行 RED → helper/调用实现 → 独立代码审核 → 所有涉及用例及完整核心/浏览器回归。复验使用原断言与真实隔离目录；历史默认 120 秒可恢复，明确保存 runner 参数，不改变单例显式 timeout。其他失败逐项定位，不能笼统归因或跳过。

前轮原始失败、人工终止和超时记录保留。新的结果另存 evidence；全部通过才可输出最终完成总结。实际 Windows 重建验证当前最终 bundle；不会以模拟 macOS 或一个启动冒烟抵扣正式业务验收。
