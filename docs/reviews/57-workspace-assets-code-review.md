# 作品图片存储与原保存适配独立审核

- 日期：2026-10-08。
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批实现作者。
- 结论：**限定范围通过（PASS）**。主代理确认本批源码已收敛；真实归属缺陷修复后，独立复验18/18通过，完整类型检查退出0。本范围内没有未关闭的阻断项；不把该结论扩大到两平台完整图片功能或531项正式验收。
- 范围：`desktop/service/workspace-assets.ts`、`image-assets.ts`；`context.ts` 的assets字段及 `workspaces.ts` 将当前作品assets传入受信上下文的变化；原 `ai/image.ts` 中角色/封面两个保存函数、`services/item-image.ts` 保存函数、`services/scene-image.ts` 的落盘、读取与失败清理变化。
- 本审核只新增独立测试、审核记录和 `implementation-10/review-*` 证据。不改实现、不运行Electron或真实provider，不修改main/index或service/index。两者的协议桥、10MiB上传IPC扩展、真实组件图像显示及正式验收不计入本结论。

## 实际发现与修复

| 问题 | 实际失败 | 修复及独立复验 |
| --- | --- | --- |
| WA57-01 · 图片回滚归属 | 原回滚凭证仅保存内容digest。真实文件系统中，用另一个文件原子rename替换同名图片，bytes完全相同、inode不同；removeCreated仍成功删除作者替换后的文件。 | 主代理将凭证改为原写入handle的dev/ino/hash；发布前读回须与原handle一致，回滚核对内容及身份，unlink前再次检查普通单链接文件和相同dev/ino。原RED不改变断言，替换文件现在保留并拒绝回滚。 |

`review-01-assets-red.tap` 的8项中7通过1失败，唯一失败是上表。补充WA57-09用现有beforeDirectorySync hook及真实rename，把同bytes替换置于发布回执之前；执行时主代理已经修复，该项首次就是GREEN，不虚构修复前RED。

`review-02-identity-interface-attempt.tap` 记录修复中一次9项8通过1失败：临时public read把用于内部验证的identity一并返回，原scene adapter深等式不符。主代理将元信息移至private readVerified，public read继续只返回bytes/mime；同一行为断言恢复通过。此记录不是新增“发布前替换”缺陷的RED，文件曾误以publication-red命名，已纠正并完整保留原内容。

## 存储、解码与失败证据

作品root由受信Workspaces连接提供，图片函数不接收renderer指定的路径。根目录和assets目录核对canonical path、dev/ino及实际directory，符号链接或身份变化拒绝；inbox、缺assets和无数据库上下文不能保存作品图片。AsyncLocalStorage并发测试分别等待/保存两个作品，URL workspaceId及实际文件不串仓。

保存先复制调用者Buffer，再检查1字节至10MiB、四种格式和claimed MIME、40M像素限制，实际sharp raw解码完整像素；不是只读取metadata。独立截断PNG夹具仍能读到有效PNG metadata，但完整解码拒绝且没有创建assets。PNG/JPEG/WebP/GIF实际编码/解码、扩展名与MIME一致；调用者随后修改原Buffer不改变落盘内容。

新文件使用随机UUID、O_EXCL/O_NOFOLLOW和0600，写入后file.sync；非Windows再同步目录，随后检查目录身份、读回字节摘要和原写入handle身份。创建凭证在所有检查完成后才登记。失败不返回可用receipt；不能确定durability的已写新文件保留，不删除未知作者数据。

真实POSIX权限测试把assets改为0500，open返回EACCES，新图没有回执，旧图字节和目录条目不变；finally恢复权限并清理临时目录。该项在当前macOS真实文件系统执行，无跳过；Windows ACL和目录同步不能由本项代证。目录sync失败由受控hook注入，验证拒绝及保留证据，不冒称真实磁盘故障或断电。

读回仅接受UUID+白名单图片扩展名；普通单链接文件、大小和open前后dev/ino/mtimeNs/ctimeNs核验，拒绝路径穿越、软硬链接及读取过程可见的替换。public接口不泄漏内部bigint身份。读取这里不重新执行sharp图片解码，完整解码是保存前保证；本批没有把人工修改文件后的图像有效性或任意外部进程并发操作当作已验收。

回滚只认本实例已确认创建且字节/身份未变的文件；新实例或不确定保存的文件没有删除授权。独立测试核对同bytes新inode替换、另一root替换、同步期间assets软链切换均不删除替换/外部作品。身份检查不是操作系统级跨进程锁，不能把这些定点探针扩大为所有外部文件系统竞态的原子删除证明。

## 原保存入口与场景适配

角色、封面、物品保留原函数签名及业务调用方，改用saveWorkImage返回 `/_desktop/assets/{workspaceUUID}/{imageUUID.ext}`；不再写安装目录或以cwd拼public/uploads。既有真实FS adapter测试把cwd切到隔离installation，调用三个实际保存入口，核对installation为空、作品assets存在三文件且可读回。

场景保留原历史URL `/api/novels/{novelId}/scenes/{sceneId}/images/{imageId}/asset`、ownedScene检查、sceneImage记录及版本基线判断。独立测试执行实际uploadSceneImage/readSceneImageAsset、真实WorkspaceAssets与真实fs，只把Prisma数据/事务替换为可控依赖：成功读取对应图片；数据库拒绝时只清本次新图、旧图保留；错误scene/image拒绝。测试执行了原用户/作品查询条件，但不是完整真实数据库事务验收。

原封面/角色/物品/场景组件仍以原img、ImageCropEditor/CroppedImage消费保存的相对URL及历史URL；本轮不改图片UI。源码检查及service层read证明格式接口兼容，不足以证明xuanxiang协议读取、浏览器自然尺寸或实际图片显示。主代理正在独立集成协议桥，该证据须单独明确范围；本轮不把真实provider生成或资产下载算通过。

## 当前独立证据

目录：`docs/evidence/implementation-10/`。

- `review-01-assets-red.tap`：独立8项7通过1失败，退出1，0跳过/取消。
- `review-02-identity-interface-attempt.tap`：修复中的公开返回结构过渡记录，9项8通过1失败；归属保护两项已经通过。
- `review-03-assets-fixes-green.tap`：独立10项、既有WorkspaceAssets 7项、原保存adapter 1项，共**18/18通过，退出0，0跳过/取消**。早期复跑及其他阶段不累加。
- `review-04-assets-typecheck.txt`：完整项目 `tsc --noEmit --incremental false --pretty false` **退出0，空诊断**。
- `review-05-independent-summary.json`：主代理确认收敛后，受审源码、测试、RED/GREEN日志和审核记录的当前SHA指纹。ai/image、context、workspaces整文件hash仅用于识别版本，通过范围限本文所列保存函数及assets传递变化。

所有fs操作仅使用mkdtemp隔离目录并finally清理；不读取真实作品、用户目录、系统剪贴板，不运行浏览器、Electron、远程服务或付费模型。当前结果是作品图片存储及原保存适配的有限代码证据，531条正式用例保持既有not-run状态。

主代理另实际操作macOS Electron原封面上传/历史和场景上传/预览成功，但原BaseUI图片对话框Escape关闭失败，现场保存在 `native-work-images-failure.json/png`。该UI命令分发缺陷另做实际BaseUI+Controller独立回归，不属于本批存储源码；不能把这些原生局部成功或整个失败烟测当作完整App图片验收通过。本审核未独立执行主程序读取桥，仍保留上述范围限制。
