# 29 应用备份库存迁移作者移交

状态为 `AUTHOR_FROZEN_PENDING_INDEPENDENT_REVIEW`，不是作者自行 PASS。新增只读应用包识别与统一容量，扩展关闭根库存、迁移 journal 的保留路径和精确包清单检查；应用备份创建显式排除 backups 历史。正文、模板、设置和候选审批领域没有更改。

作者范围为 7 个生产文件、1 个新增测试文件及本批合同/清单生成器。根维护 runner、迁移请求和进度 UI 接线由 root 代理实现，列为只读依赖。此移交不回写 17、59、72 等已审冻结历史。

## TDD 证据来源

首次 01 日志包含 AM29-07 journal 路径夹具错误，不能称纯行为 RED。仅校正文件名后 02 的 7 项为 6 FAIL / 1 PASS：健康包缺库存、未知包和候选路径丢失、真实迁移不保留精确 pending、包 allowlist 不支持和旧 20000 数量上限拒绝。03 是作者抽取递归函数缺返回类型的 TypeScript 错误，修复后 04 的 7 项和 05 类型通过。

06 独立于首次用例，checksum 正确但 catalog 错误的真实坏包被接受，实际 1 项 RED；修复复用原 catalog schema。07 是当时 8 个新增用例加旧回归 105 项通过。08 加入库存后坏包不能成为新基线、超大 journal 写入不能覆盖旧日志，10 个新增通过。09 类型与 10 的 107 项是末次源码修订前的通过记录，不冒称最终冻结证据。

11 真实根目录在 `opendir` 后置换，身份检查失败但实际句柄仍可读，1 项 RED；在原扫描增加仅负责释放 Dir 的 finally。v1 最终 12 相关实跑 9 文件 108 项通过，13 全量 TypeScript exit 0。所有旧日志保留，不改失败为成功。

根代理另提供 `migration-request-03-capacity-red.tap`、`migration-runner-04-preserved-red.tap`、`migration-view-05-capacity-red.tap` 及宿主 06/08、implementation-28 UI 05 结果。宿主 07 的 7 个旧断言以 complete 描述真实 unknown.txt 保留情况，root 将这些修订为 cleanup-pending 并核验 pending 明细；旧无 preserved 的直接 journal 兼容例仍 complete。作者没有修改这些断言。

## 提供审核者的关键边界

- 包识别须只读、有界、完整认领，非法包整体保留；owner/关闭检查失败不能降级成普通坏包继续迁移。
- `preserved` 在任何源 owned 删除前持久；cleanup 仅查询存在性，不执行保留对象，不删除 staging/validation。
- 租约清单与重新检查后的包匹配，物理身份变化不能成为新基线；收尾同步 seal 后无额外异步网络/数据库动作。
- 备份创建不递归收集历史包，已迁移包仍能由原 ApplicationBackups 读取，元数据字节保持原值。
- 原 16 MiB journal 读写不匹配被统一为 64 MiB；数量和字节均有界，超限先拒绝且不覆盖旧日志。

这批是实际 FS 与受控 verifier 的作者开发验证，无重新验证数据库健康、运行中的 Electron 闭库/两次重启、真实 Windows 或正式 531 用户验收。后续独立审核发现由作者定向修复并保留 v1，再重新冻结。

## 96 独立发现的定向修复与 v2

独立 reviewer `/root/ui_revision_review` 的纯 RED02 为 2 PASS /3 FAIL：AM96-01 source catalog 读取之后变化却被新 hash 接受，导致新登记作品目录的原数据删除；AM96-02 62502 文件两位置回滚超原125002 pending 而无法写结果；AM96-05 跳过包时最后宿主 await 换 root 仍返回失效库存。保持其原 oracle，分别固定 catalog 生命周期 proof、推导并统一225002预算与合计容量、最终 root 同步身份检查。容量 driver 在新上限下只改为允许的100000文件，原62502失败证据保留。

独立 AM96-09 在最后 cleanup assertClosed await 新增 catalog，原 guardedUnlink 仍删除新登记路径的剩余文件，纯 RED09 保留。修复在 final async guard/文件版本检查之后同步核 source catalog/root/同 inode 版本，再同步 unlink；缺失 source 分支同样不能绕过 proof。不删除新作品剩余字节，不承诺回滚先前已删项。

作者另补 ABM29-12/13：ready-to-commit hook 的晚 catalog 改动原 pointer 仍提交，15 为1 FAIL/1 PASS；补最终 pointer callback seal。13 明确提交后变化仍保留源作品并拒绝不可信续删。ABM29-14 在最后目录身份 await 改 catalog，原真实 rmdir 使空目录消失，17 为1 FAIL；同步 seal 覆盖 owned directories、parents 与 inbox。未修改任何 reviewer 断言。16 scoped37、18 scoped38均通过；最终19十文件120/120、0跳过退出0，20全项目types0空诊断。作者新增14，包含独立9的相关总120不能累加为正式用例覆盖。

核心7生产已冻结等96独立最终复验，原v1合同/清单/生成器/移交快照单独保存。2份独立测试及其历史/实际React结果列来源，作者不自行授PASS。此次未运行PG、原生迁移、系统chooser、Windows或531。
