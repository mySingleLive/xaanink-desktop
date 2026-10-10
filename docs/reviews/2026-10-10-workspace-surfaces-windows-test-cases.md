# Windows 目录同步测试用例

2026-10-10，产品尚未修改。先通过既有 FileExports 公共入口添加行为测试，避免以缺少新 helper 模块作为 RED。

| ID | 操作与断言 | 边界 |
| --- | --- | --- |
| WDS-01 | 隔离真实 Windows 导出，精确字节/hash/保存确认，目录无临时残留 | 原 EX16-01 已失败；原用例保留 |
| WDS-02 | 固定真实目录句柄 stat 后 sync 抛 EPERM+fsync，win32 返回 saved；确认 open/stat/sync/close 全部执行 | 新正例应 RED |
| WDS-03 | 相同 EPERM：open、stat、close 或 sync 无 syscall/不同 syscall 全部 unconfirmed | 不能吞权限错误 |
| WDS-04 | sync EIO/EACCES/ENOENT/EBADF、close ENOTSUP/ENOSYS，stat EINVAL 全部拒绝 ACK | 不能按 code 不分 phase |
| WDS-05 | 原支持 open EISDIR/ENOTSUP/EOPNOTSUPP/ENOSYS、sync EINVAL/ENOTSUP/EOPNOTSUPP/ENOSYS，win32 可继续 | 既有策略保留，使用真实路径验证 |
| WDS-06 | 同 WDS-02 及原 unsupported 错误在 darwin/linux 选项下失败 | 模拟平台仅验证分支，非原生验收 |
| WDS-07 | handle stat 报非目录/不同 dev-ino，sync 不能执行；目录在 sync 或 close 时被换掉，则拒绝 ACK并保留外来文件 | 身份与路径前后封印 |
| WDS-08 | 普通临时文件 sync 抛 EPERM+fsync，则 write failed、原文保持，无 saved | 例外不进入文件 fsync |
| WDS-09 | 全部原 FileExports、lease recovery、root relocation、authority/application consumer 原断言重跑 | 不取消 guard/授权/关闭/后置读检查 |
| WDS-10 | 实际 Windows Electron 真实隔离导出及该 UI 39 点脚本随最终 rebuild 复验 | 当前构建绑定，零模型、离线，无真实资料 |

实现后补共享 helper 直接用例，覆盖 pre-open identity、open 后异步置换、stat 同身份、close 后置换、所有错误阶段，防止其余调用者绕过导出外层校验。

所有 mock 仅注入精确 fs 操作失败，文件写入、文件 fsync、rename、内容读回及目录均真实。完整 runner 恢复历史默认 120000ms，concurrency4；保留各单例显式 timeout，不以提高时限掩盖永不 resolve 的 hook。若全量存在卡住 worker，保存身份与失败，不标通过。全部原始日志不可覆盖。

完整 core/browser、TypeScript、foundation、UI/desktop build 通过后独立审查报告及源码/bundle 指纹。保留前轮失败统计，不用局部重跑改写全量结果。已取消备份不复活，正式 activeScope 仍遵守原台账边界。
