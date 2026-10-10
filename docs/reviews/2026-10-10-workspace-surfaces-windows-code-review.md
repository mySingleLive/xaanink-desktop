# Windows 目录同步实现独立代码审核

2026-10-10。只读审核共享目录helper、四处业务调用diff、两个新增unit文件及提供的TAP日志。本代理未改产品或测试，只新增本审核文件；另外执行一个仅使用新temp目录的内存审查探针，结束后恢复mock并清理该隔离目录。

**最终代码审核结论：通过；初审发现的1项blocking清理竞态已关闭，当前审核范围无未关闭必修项。** 目录同步helper与四处接入符合批准方案，file-export新增清理已复核最终同步身份/版本seal及针对性RED→GREEN。此结论是代码审核通过，不是全部测试或最终安装包验收通过。

## 已关闭：文件flush失败后的临时清理异步路径竞态

初审产品版本 `desktop/main/file-export.ts` SHA-256为 `bc7b8e5794868299c0bf9f9b5b86dea3f640691fc2451f5898054eee07240ddc`。该版本在writeFile后、sync前更新owned stat，解决WDS-08发现的本次临时文件残留，但cleanup仍以 `await lstat(temporary)` 取得快照，比较sameRevision后 `await unlink(temporary)`，路径可在二者之间被换成外来文件。新stat使普通文件fsync失败时进入清理分支，原WDS-08无残留正例不足以证明安全。

独立隔离探针在该初审版本实际复现：仅令`wx`临时文件的sync抛EPERM/fsync；cleanup的真实lstat取得owned快照后，mock在返回旧stat前把owned临时文件rename到`owned-retained`，并在原路径写入`foreign author content`。初审实现返回EXPORT_WRITE_FAILED，selected原文保持、owned-retained原导出字节保持，**foreignExists=false，外来文件已被删除**。探针只改变系统调用时序，真实write/rename/lstat/unlink均执行，没有改产品源码或作者数据。

最终 `file-export.ts:98` 捕获原canonical目录及其info；第130行仍把异步lstat作为前置观察，第134行同步读取父目录并检查其为非symlink目录、dev/ino与原info相同且realpath仍为原canonical路径，第136行重取最终叶stat，要求isFile、非symlink、nlink=1以及完整sameRevision（dev/ino/size/mtimeNs/ctimeNs），随后第137行紧邻unlinkSync。最后seal与删除间没有await或业务hook，未知身份/路径或清理失败保留文件。与既有 `work-lease-recovery.ts:246` 的删除前同步seal一致，未改成按后缀/inode宽删。

保留的 `windows-cleanup-race-red.log` 为1项0通过1失败，外来临时路径readFile返回ENOENT，确认被旧清理删除；新增WDS-08-race在两个37/37 GREEN日志中通过。既有 `tests/unit/file-export.test.ts:67` 的EX16-09外来同字节wx替换拒绝/保留用例仍在源码中，本次37项TAP不包含该文件，不能在这里宣称它已重跑通过。

本代理以最终源码再次执行同一隔离时序探针：Node v24.19.0 / win32，返回EXPORT_WRITE_FAILED，foreignPreserved=true、selectedPreserved=true、ownedBytesPreserved=true，命令退出0。运行后恢复所有内存mock，核对temp真实父路径及专用前缀后清理该目录。同步seal关闭本次Node异步让出窗口；不把它描述为操作系统跨进程原子unlink保证。

## 已核对符合方案的部分

- `directory-sync.ts:16–38` 在进入时私有复制并冻结原identity，前置canonical/非symlink/dev/ino验证在能力catch外；打开后handle.stat必须为同一目录，并在phase=stat时再次验证路径。phase只有验证通过后才到sync，等价于verifiedDirectory门控。
- 例外仅新添Windows/sync/EPERM/syscall=fsync。open/stat/close的EPERM、缺/其他syscall、EIO/EACCES/ENOENT/EBADF均失败；原明确允许的分支按phase保留。关闭期间保持phase=close，关闭失败不被先前可豁免sync错误覆盖。关闭后路径检查在catch外。未复制旧authority/relocation的EBADF宽例外。
- file-export保留有效平台`options.platform ?? process.platform`，使用原canonical及已取得的目录dev/ino。业务beforeDirectorySync在helper外，protect、父目录检查、完整readOwned及读后最终授权未删除；普通文件fsync错误没有进入目录例外。
- work-lease两处使用request.work；确认、closed、sameAudit、owner/lock证明、删除前原audit seal及cleanup-pending语义保留。root-relocation只替换同步helper别名，receipt/pointer同步CAS与rename及后置guard/seal没有改变。
- root-authority导出helper别名，原application消费者继续保留各自guard/控制文件证明与读后seal。没有改root-ownership的Win分支、恢复已取消备份UI、冷源权限检查或头像/macOS等范围。

这里报告的是既有Windows只读目录句柄的能力限制，不是Windows目录fsync成功或断电耐久保证。代码注释及实施范围没有扩大这个结论。

## 用例与已提供执行证据

两个新增unit文件最终源码包含：5项helper身份、open/sync/close期间置换、handle非目录/身份错误、close覆盖sync能力错误及私有identity副本测试；5项FileExports行为测试（新增WDS-08-race），其中phase/platform矩阵在一项内迭代。新10项与原lease27项组成提供的两个37项日志：

| 日志 | 实际结果 | SHA-256 |
| --- | --- | --- |
| windows-cleanup-race-red.log | 1 test / 0 pass / 1 fail | c19af2d9c96524b3450fcd0a99c744739c4a2a9c632ac6d7fd76ba5c36c46e13 |
| windows-directory-cleanup-green.log | 37 tests / 37 pass / 0 fail、cancelled、skipped | 3e15298131202df84a0e852b9c32d712f0de7c3ea6ae9ec64330bafd530e6316 |
| windows-directory-sealed-37-final.log | 37 tests / 37 pass / 0 fail、cancelled、skipped | e7cd72d3f2b058be878853fd7eefaacddd842e8794923723b6e0ff4b1a19bd40 |

原 `windows-directory-red.log` 为4项3通过1失败；`windows-directory-green.log` 为31项30通过1失败，WDS-08在加入无临时残留断言后暴露清理问题，失败保留。此前 `windows-directory-green-final.log` 的36/36为加race前结果，其SHA-256为 `1854ccd0dd5d538d768db6d27d6584545d3aa446c8f3ea56b7d4afc62cd174f7`。最终37/37包含本次竞态回归，仍只代表这些测试，不代表四调用者完整回归、全量core/browser、重建后的实际Electron或新安装包已通过。本代理未自行重跑上述套件，不从没有命令元数据的TAP推断执行命令/平台验收范围。

后续仍需按测试审核清单在最终冻结源码上完成所有真实调用者相关回归、TypeScript与构建、实际Windows最终bundle验证。模拟darwin/linux选项只能证明分支行为，不能抵扣原生平台验收。主代理说明本轮全量core/browser在cleanup修复前已启动，因此相应统计只能用于混合快照诊断，不能作为最终冻结版本的通过依据；此前native-local-07也早于本次后端修改，不能自动沿用为本次后端实际验证。未把冷源/头像/macOS等未修改范围的失败推定为已解决或无新增。

## 最终复核指纹

| 文件 | SHA-256 |
| --- | --- |
| desktop/core/directory-sync.ts | 293164e32103b5c190d36a49158d9d3770265e07d37af0b4ce3b15083156f5f7 |
| desktop/main/file-export.ts | 668614181e71ec718511917486a1f085988df5cb0da1ecb9c4e03cfb92ad6996 |
| desktop/core/work-lease-recovery.ts | 0ae6668f37d8013ca36f7e7a6ac1ec66d08e6bd7d2aaa180e642b0c408721b85 |
| desktop/core/root-relocation.ts | 467070404dae4a58986acc5c04a07c93901eb8258a5238a57ba498838662a20f |
| desktop/core/root-authority.ts | 2a5453149ab75f8d3e5738259f4d7805d36f2cf669cd4bde7d23a27a18562149 |
| tests/unit/directory-sync.test.ts | 2b73eb9ea513a16f7f7df35f369a4b376184944e064ee9480b22bf8a8693d0a2 |
| tests/unit/file-export-directory-sync.test.ts | b555f6285121682bd197fb3705141808384a5bb751f4f868a5a41d61e93738f6 |

此指纹绑定最终复核时的源码及两个新增测试文件。后续修改需重新绑定审核/执行证据，不能把混合快照总计或旧bundle通过记录冒充最终验收。

## 追加：EX16-15真实Windows ACL夹具与冻结证据

五个后端产品与上表指纹一致，未新增产品修改。新增审核 `tests/unit/file-export.test.ts:88` 的Windows分支：先验证新temp根绝对路径、专用前缀及真实父目录等于tmpdir；whoami返回当前SID，icacls用参数数组只对该根拒绝WD/AD，真实wx必须EACCES/EPERM；finally移除deny。没有递归/继承ACL、shell命令拼接或mock权限错误；原失败/固定错误码/原文与目录无残留断言保留，非Windowschmod分支保持。此夹具修改无blocking，文件SHA-256 `3fbe99f83da87f2eef52c0a2c6f4d4b4adeb3673e4f0e82752bfa3a53ca5998c`。本代理未执行ACL变更，只核对源码、提供的实际EPERM/restoration probe日志及最终TAP。

`directory-final-affected-acl.log` 146/146、0失败/取消/跳过，包含原EX16-09同字节外来tmp保留、EX16-15及WDS-08-race；日志SHA `7644747e3674320d3eb33ff34f5926595f2ff45d7280aa7895693b1c2b3644e0`。因此上文“37 TAP不包含原EX16-09”的历史限制保留，但此原用例已有后续实际通过记录。冻结后的browser-export-sealed-final原7项7/7、TypeScript/foundation/build exit0与native08当前产品bundle已在执行证据审核追加核对；完整core混合快照1746项仍44失败、3取消、2跳过，代码审核通过不升级为完整验收通过。
