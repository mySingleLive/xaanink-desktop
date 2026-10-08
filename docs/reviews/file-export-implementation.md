# 正文与模板导出保存实现交接

v2定向修订：review83 EXP83-01真实FS探针在最终文件读取期间替换父目录、搬入同一inode文件，旧代码错误ACK。保留v1与原独立RED；最终readOwned之后新增保护边界和parent/canonical/dev/inode复核，rename后此类失效返回DURABILITY_UNCONFIRMED。EXP83-04在实际xuanxiang来源缺preload时错误退回Web下载；现在分别检测桌面来源与桥，缺桥固定报错。新增作者HTTP Web正向下载/清理测试首GREEN。修后作者22Node+独立7=29/29（file-export-v2-node-green.tap），新增7实际React复跑、20旧模板回归使唯一相关计数56（含3项root main独立依赖检查，root完整接线另审）。独立审核者继续复验，作者不自授PASS。

日期：2026-10-08；作者：`product_revision_review`。实现已完成作者验证，交非作者独立审核；作者不授予独立 PASS。

原 Web 四格式导出把 Blob 交给 objectURL 下载；桌面必须由用户原生选择路径，并等待真实落盘。现在保留原正文、整书和模板 UI/格式函数，只将下载终点换为主进程受信保存通道，取消或失效不提示成功。

## 作者范围与接线

新增 `desktop/main/file-export.ts`、`desktop/shared/file-export.ts`、`src/lib/desktop/export.ts` 和三个测试文件。最小修改原 `downloadManuscript`、`ChapterContentPanel`、`OutlineTreeMenu`、`TemplateManagementDialog`。单章仍读取当前草稿快照，整书仍合入原编辑器登记草稿，正文保存/版本/候选/定稿代码未改。详细接口与生命周期见 [合同](../evidence/implementation-16/file-export-contract.md)。

主进程接线由 root 作者拥有：受信 frame 和当前会话 nonce→`FileExports.save`；原生 SaveDialog 返回目标；`exportFile/cancelFileExport` 经 preload 暴露；`guardFileExportTarget` 保护应用内部数据。窗口关闭/会话失效先取消所属请求，关闭库前等待 `flush`。本清单不冻结 `main/index.ts`、IPC、preload、`file-export-target.ts` 或其测试；这些由独立接线范围验证，不能用本模块作者结果替代。

模板第79轮冻结原样保留。本次该文件唯一后续差异为把 `downloadManuscript(...)` 改成 `await downloadManuscript(..., {signal: job.controller.signal})`。冻结记录通过逆向去掉这处后与79 v2 SHA对比证明最小范围；原模板领域服务、Prompt/Wizard 编辑器与401模板 corpus 未改。

## 行为与边界

renderer 只传有界 UUID/格式/basename/Uint8Array，没有目标路径。重复请求和近期ID重放拒绝，8个物理写入预算不会因业务取消提前释放。main 原生选择授权后仍拒绝符号链接、硬链接、目录和外部替换；wx 临时文件持有实际 fd 身份，写入/fsync/rename/目录同步/最终身份和散列确认后才 ACK。无法确认 rename 后完整终态返回 `EXPORT_DURABILITY_UNCONFIRMED`，不会谎称没有写入。

每平台都尝试目录同步。Windows 仅豁免合同列明的 unsupported 系统错误，普通 EIO、权限或 close 失败不能 ACK。测试分别注入 ENOTSUP/EIO 并实际观察目录 open；这不是 Windows 实机证明。

导出不新增模型请求、自动保存或批准。模板严格复用现有无Key schema。正文转换器保留原中文字体、OOXML、书籍封面/长简介/分页；PDF字体不支持符号则明确失败，不裁剪正文。

## TDD与验证

原始失败证据保留：`01-red` 是主进程初始未实现的10项实际行为失败；`04-renderer-red` 是5项有效 renderer 行为失败（1项首绿）；`06-pending-budget-red` 是取消物理写入预算未落实的实际失败；`12-windows-sync-red` 是跳过 Windows 目录同步的实际失败。修复后的绿证据单列，没有把历史同例重复计数。

失败尝试归属明确：`03-renderer-red` 初版夹具等待未调用bridge导致挂起，不作为有效行为RED；`08/11/20` 为作者测试/类型修订；`09` 为字符串转义 build 夹具；`10` 为夹具局部 `document` 遮蔽浏览器文档；`13` 为macOS `/var` 与 `/private/var` 目录mock匹配错误；`15` 为docx9散列图片文件名、PDF.js正确销毁对象及首次取消等待顺序；`18` 原章节预览自身渲染外部图片的请求与转换器断网oracle混淆，改用纯文本章稿，未修改产品或放宽转换器网络oracle。

当前15个主进程真实FS测试 +6个 renderer Blob测试共21项（`19-node-final`）。新增7个实际 React/BaseUI/Chromium测试覆盖四格式单章/整书、模板保存/取消/迟到、原集合菜单、原章正文卸载取消与再导出、字体失败；联合79原模板管理/向导/独立UI20项为27项（`final-browser`）。最后PDF嵌字体检查改为安装版类型支持的 context.lookup，并在 `final-formats` 再跑7项；`final-typecheck` 为全量tsc0。最终退出码、实际计数和 SHA 由冻结清单记账。

四格式校验实际读取已保存文件：TXT UTF-8 BOM和纯文本、Markdown完整源文、DOCX解压OOXML/作者/封面尺寸、PDF多页/嵌中文字体/实际PDF.js中文提取，整书章卷顺序不丢。HTML未执行、转换器未请求源文远程图片或链接、无浏览器下载事件。真实只读目录、外部目标更换、foreign同字节临时inode替换、提交前后owner失效、源字节修改、取消迟到均有明确oracle。

Chrome夹具使用实际原组件和语义CSS，仅 source API、IPC、SaveDialog返回路径受控，主进程确实写隔离临时磁盘。章节保持原预览；本批未实例化Monaco/执行物理键盘/打开可见Electron，未证明系统保存对话框、真实权限提示、Windows安装版或531全部验收。没有使用真实用户数据、真实Key、付费服务、发布操作或新增依赖。

复验：Node24 `--import tsx --test --test-reporter=tap` 对作者两个unit文件；既有 Chromium1228 对 `tests/browser/file-export.test.ts` 与 `local-template-management/local-wizard-templates/local-template-library-review`；全量 `node_modules/typescript/bin/tsc --noEmit`。命令参数/产物精确记录于 `file-export-frozen.json`。冻结后独立review83按此限定范围执行，必要修复保留v1及真实RED。
