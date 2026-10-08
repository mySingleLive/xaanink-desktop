# 83 · 正文及模板文件导出独立代码审核

结论：**限定通过**。审核者独立执行 66 项 Node 和 27 项实际 React/BaseUI/Chromium 检查，共 **93/93**，无跳过、取消或失败；全项目类型检查退出 0、空诊断。两项 P2 真实缺陷由作者修复，原独立断言保持并通过。core v2 74 项与 main v2 29 项清单记录的 SHA、两份聚合均独立核验匹配。

## 范围与独立性

合并范围是作者 `file-export-frozen.json` 的导出核心、共享格式/schema、renderer 保存适配、原单章/整书/模板入口，以及主代理 `file-export-main-frozen.json` 的实际 main/preload/IPC 接线和目标保护。相邻 main 中的模型、头像、配置、恢复业务只作上下文，不扩审其领域功能。

审核者未参与本轮导出实现。审核期间仅新增 `file-export-review.test.ts`（3 项）、`desktop-export-review.test.ts`（1 项）、`file-export-main-review.test.ts`（3 项）及报告/证据；没有修改生产代码、作者测试或作者冻结清单。main 行为测试提取当前源码 AST，执行实际 trusted、closeData、releaseOwner；宿主和事件由隔离夹具提供，文件写入与 BusinessGate 为真实实现。

本轮计数按最终一次执行的文件并集计算：作者导出核心/renderer 22 项、main 接线相关 37 项、独立新增 7 项，合计 Node 66；原四格式组件及模板相关 React 27 项。作者此前 48、主代理此前 37、定向 29 等结果有交集，未相加作为覆盖率或正式用例完成数。

最终冻结：core v2 `46cf144702d6f3a34d77e8420819adc5d8082e1d5b61d7664e56e0a0de7a2c60`，按13项 `files` 后接3项 `independentTests` 的 `path:sha256` 每项末尾 LF 聚合；24 项只读依赖及34项证据单独核验。main v2 `ad76f692b86f702e08fd0398efb6facba99ea316c07037538376e94bd7ef72b5`，按 `sources/tests/harnessUpdates/dependencies/evidence` 顺序同样带末尾 LF 聚合；main v2 仅协调修复后的依赖指纹，未额外改变接线逻辑。两份 v1 清单及原始 RED 保留。74/29 是各清单条目数，有重复依赖，不能称为103个独立实现文件。

## 发现及修复

| 发现 | 严重度 | 实际行为与影响 | 作者修复和复审 |
| --- | --- | --- | --- |
| EXP83-01：最后异步字节校验后缺父目录复核 | P2 | rename 后，在最终 `readOwned(path)` 打开文件时真实替换已选择的父目录，再把原 owned 文件同 inode 移入新目录。字节/散列仍正确，但授权目录身份已变化，原实现返回 `saved`。 | 最后文件读取结束后重新核验保护边界与原 parent/canonical/dev/inode/realpath，再检查 owner。原测试现在返回 `EXPORT_DURABILITY_UNCONFIRMED`，不声称没有写入。 |
| EXP83-04：桌面缺桥误走 Web 下载 | P2 | 实际 `downloadManuscript` 在 `xuanxiang:` app 来源、preload bridge 缺失时触发 objectURL 分支。其合同要求固定桌面失败；main 又禁止自动下载，不能把生成 Blob 当作保存回执。 | 作者将桌面来源辨识与桥对象存在分开；桌面缺桥报固定保存错误。原失败断言通过，作者新增正向 HTTP Web 下载/60 秒 URL 清理回归通过。 |

EXP83-01 使用 fs.open 的精确注入点执行真实 rename/mkdir/文件移动，并读取实际结果；不伪造文件 stat 或散列。EXP83-04 执行原导出函数，以隔离 DOM/origin 夹具观察 objectURL 是否被调用，不把模拟 preload 缺失说成 Electron 实际故障复现。两项均没有证明用户原正文被删除。

## 独立守卫与相关回归

- 同字节但新 inode 的已选择原目标不能覆盖，foreign 文档保留；commit 后取消不能提前结算 flush，真实目录同步 gate 未释放时仍等待；rename 已提交的失效结果为 durability-unconfirmed。
- actual trusted 只接受当前 webContents 的精确 mainFrame：同 origin 子 frame、旧 frame 或相同 id 的不同 sender 对象均拒绝。实际 closeData 先取消并关闭业务准入，真实 post-rename I/O 未结束时不调用 worker close；完成后才关闭业务服务。实际 releaseOwner 的 `8:` 不能误取消 `80:` 窗口的导出。
- renderer payload 仅为 UUID/格式/basename/字节；无 renderer 指定目标路径或 owner。原生选择由 main 宿主提供；schema、大小、UTF-8/模板 schema、PDF/DOCX 类型标识验证先于保存。符号链接、硬链接、目录目标、原目标和临时文件 foreign 替换受限，错误为固定 code。
- 应用数据根/bootstrap 整段保护；作品普通稿件可保存，manifest、storage 指针/required marker、锁、database、assets、backups、snapshots、restores/preserved 等内部不可覆盖。未登记或损坏 marker、目录别名和未知权限错误不能绕过。
- Windows 目录同步分支尝试真实 directory open；只允许合同列明 unsupported 例外，EIO 等错误不能成功 ACK。该分支在 macOS 隔离 FS 下以明确平台/error 注入验证，不代表 Windows 文件系统实机行为。
- 原 TXT/Markdown/DOCX/PDF 转换及原组件复用：实际读取已保存文件，核验 TXT BOM/纯文、Markdown 源文、OOXML/作者/封面、PDF 多页/嵌中文字体/中文提取/章节顺序。转换器不执行 HTML、不下载稿件外部图片/链接；字体不支持符号明确失败，不静默裁剪。
- 单章从开始导出时的原正文草稿快照取值，整书沿原集合/编辑器草稿边界；不自动保存、批准或调用模型。原模板管理等待保存，取消/卸载使旧 job 失效；模板 schema 不包含模型凭据字段。第79轮历史冻结保留，本轮最小下载差异单独记账。

## 证据

目录：`docs/evidence/implementation-16/`。

- `review83-01-initial-manifests.json`：v1 core 清单 57 项及聚合、main 清单 29 项及聚合全部匹配。
- `review83-02-independent-fs-red.tap`：独立 FS 3 项，2 PASS/1 FAIL；EXP83-01 的真实 saved 错误回执。
- `review83-03-independent-main-renderer-red.tap`：actual main 3 PASS、缺桥分支 1 FAIL；没有编译或夹具失败。
- `review83-04-independent-fs-first-fix.tap`、`review83-06-independent-fixes-green.tap`：首修 3/3、最终独立原断言 7/7。
- `review83-07-final-related-node-green.tap`：11 文件 66/66，退出 0。
- `review83-08-final-related-react-green.tap`：4 文件 27/27，退出 0。
- `review83-09-final-typecheck.txt`：全项目 `tsc --noEmit --pretty false` 退出 0，0 字节诊断。
- `review83-10-final-manifests.json`：core/main v2 的全部清单条目及聚合核验；相关旧 W71 六项只作为只读回归观察。

没有为了制造 RED 修改生产源或作者 oracle。作者旧导出、字体、CSS、临时目录别名、parser 销毁及 main VM 缺新服务依赖的失败归属已在作者合同/报告中区分。本审核确认旧 main VM 只补 `fileExports.cancelWindow/flush` 依赖，没有放宽原关闭/恢复断言。最终 93 项没有跳过这些回归。

## 原生证据引用与限制

主代理提供的 `native-file-export.json` / run 文本及两张截图记载三个 macOS Electron 开发检查组：原 Monaco 未批准草稿导出、原模板 401 项通过 native IPC 保存、live state.json 覆盖拒绝且字节不变。本审核只读取并核验该证据归属，**没有亲自运行这些 Electron 检查**；SaveDialog 返回值仍受控，不是物理操作系统选择器。PDF 的原生组只核 parse/作品元数据，中文提取由本轮 browser parser 检查证明，二者不混作同一断言。

审核者实跑的 browser 使用实际原 React/BaseUI/MarkdownEditor preview 组件和语义 CSS，Electron IPC/picker、source API 为受控桥，实际 FileExports 写隔离磁盘；不实例化完整 Monaco，不证明真实系统剪贴板、OS 权限提示或 Windows 安装版。本报告不升级为 531 项正式验收，不覆盖独立先前的恢复草稿导出写盘功能。
