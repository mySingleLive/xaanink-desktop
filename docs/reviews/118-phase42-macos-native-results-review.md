# 118 · 阶段 42 macOS 有限原生结果审核

结论：**PASS_LIMITED_NATIVE_RESULTS**。保存证据支持：本次冷启动取消保留旧租约，本次明确修复后回执断言完成且原数据库/五项元数据前后相同，两次 owned 冷进程均 code 0、无信号、无强止；后续一批实际普通工作台启动及原 `app.quit` 正常退出已记录。首轮非 TTY 运行仍为失败。结论只针对下列具体运行，不授予正式 530 项、Windows、供应商、所有业务或跨启动保存可靠性 PASS。

2026-10-08。审核者只读仓库中的原始 JSON、根代理 CUA 见证记录、117 报告、冻结/脚本/源码及四个固定包文件，并查看一张已保存 PNG。未启动 App、Electron、PG，未探测当前进程，未读取 HOME/appData 现存数据或锁，未修改生产或 harness。独立检查程序仅比较已保存的数组与固定仓库文件，绝不跟随 JSON 中的默认数据路径读取文件。

## 固定对象和独立读回

实际对象是 `release/mac-arm64/玄印写作.app` 的未签名 macOS arm64 0.1.0 包，不推断已安装到 `/Applications` 或曾执行 DMG 安装流程。

| 对象 | 核对的 SHA256 |
| --- | --- |
| 117 前置 harness 审核报告 | `d7325f658fcc334ca18891ad96f07d60a1e11c7ec4810dc5b3519577ef5335d6` |
| 实际使用的 `acceptance-packaged-macos.mjs` 当前字节 | `10a2bab10b9b1d66ce22610a8e1effe2569c65097df63a6846ae1cc6eaa55059` |
| 阶段 42 `packaging-frozen-v1.json` | `d2c4eb91b6183de41b3a5bbe811c99018260d907c50526007632f9d01835a968` |
| 阶段 42 包完整文件表 manifest | `e5870a36058e204ca771977343e9d3351f8e40383e0d31698b70da0715bbb0a2` |

独立 `review118-saved-evidence-check.mjs` exit 0，结果为 `review118-01-saved-evidence-check.json`，MATCH_LIMITED。核对 16 个保存证据/源码输入、四个 actual `.app` 文件（Info.plist、可执行文件、main/service bundle）SHA；四生产源码及 116 报告与 42 冻结一致。没有重新枚举全部 27009 个包文件；每次运行 JSON 的 `packageVerification` 是已审 harness 在启动前执行完整文件表/文件 SHA 比对后的运行结果，四轮都指向上述同一 freeze/manifest。

## 逐运行结论

| 运行 / PID | 保存的退出和数据证据 | 有限结论 |
| --- | --- | --- |
| `d49032f1` / 79929 | App exit code 0、无信号、无强止；未登记 expectedColdOutcome，cleanNormalExit=false，errors=2，无 after data/assertion 成绩 | **FAIL_HARNESS_ATTEMPT**。根见证原生“退出”已点击；非 TTY stdin 关闭使预期登记缺失。不得因 App code 0 把本轮改为验收通过，也不能据此称产品 RED。 |
| `abfd8565` / 80388 | expected cancel、errors=[]、code 0、signal=null、forced=false、cleanNormalExit=true；独立重比 1302 DB path/size/SHA 完全一致，五项应用 metadata 身份/size/SHA 完全一致，owner/audit 保存记录完全一致 | **LIMITED_CANCEL_PASS**。根 CUA 见证实际系统“退出”；取消前后旧 owner 原字节/身份和 audit absent 状态不变。lock 目录身份保持由 source-pinned harness 实际断言记录支持。 |
| `7785c0ab` / 81339 | expected repair、errors=[]、code 0、signal=null、forced=false；独立重比 1302 DB 行与五项 metadata 完全一致；owner absent，audit 973 bytes/SHA `3809d3e3…9845541`；coldDataAssertions.passed=true | **LIMITED_REPAIR_PASS**。根 CUA 见证实际点“修复并退出”、系统成功结果提示及退出。源绑定 strict audit、两次 lock absence、ownerProof/lock revision 断言由已钉源 harness 运行成绩支持，见下述可重算边界。 |
| CUA 观察启动 / 81601 | 根见证：对已退出目标调用 getAXState 导致新实例，系统 About 显示 Version 0.1.0，菜单退出；保存总结记录 ESRCH、lock absent，exit code 不可得 | **AUTHOR_WITNESS_ONLY**。不能计为 cleanExit，也不能把观察工具启动归因于核心 autorelaunch。审核者未独立做当前 PID/锁探测。 |
| `f92140b8` / 82900 | errors=[]、packaged=true、版本 0.1.0、sandbox=true、`xaanink://app/`、默认测试根、theme=system、modelCount=0；normalQuitRequested=true，actual child code 0、signal=null、forced=false、cleanNormalExit=true | **LIMITED_ORDINARY_READY_AND_QUIT_PASS**。普通模式为 Playwright 启动/只读诊断；原 `app.quit` 调用与实际 owned PID 退出已记录。不把 inspector/诊断环境称作纯系统启动，不扩大为所有保存持久化成功。 |

取消、修复之前的 owner SHA 都是阶段 41 诊断的 `bb36c7d8351beb5c4a82275dccf2237f55bf70c34d69a8bec10719e9d46f0ad1`；根/默认 bootstrap 记录也一致，体现处理的是同一测试环境中的旧租约。独立比较发现零 DB/五 metadata 差异；本结论只是该次前后状态，不证明任意时刻无外部写入，也不把文件 SHA 等同于全部业务语义健康。

## 系统操作和证据来源

根代理的 `native-observations-01.md` 是实际 CUA 见证：冷取消、修复/成功提示、81601 的原生 About/菜单退出，以及 82900 的实际设置操作。两个成功 cold JSON 的 screenshots 均为空，系统 dialog 图像只在根聊天 CUA 工具输出中。审核者没有独立看见或重新点击这些按钮，`expect-exit` stdin flag 自身也不证明按钮点击；有限 native 结论使用该根见证和 actual child/data 断言共同支撑。

原始 native JSON 保存了数据库/元数据完整比较行、旧 owner hash/身份与审计前后摘要，但未保存内存中的 beforeLease 完整 revision/base64、最终 audit envelope。因此本审核能够独立重算 1302 行和五 metadata 的比较，**不能仅由 JSON 重算所有 recovered receipt/ownerProof/lock revision/checksum 语义**。已审 harness 源码在 `coldDataAssertions.passed=true` 之前确实调用冻结的 `observeWorkLeaseAudit`，核原真实文件与 source identity、ownerProof、lock revision 和审计转换，再确认锁不存在；这部分限定为 source-pinned runtime assertion，不能冒称另一套独立 raw receipt 校验。没有为补齐证据读取现在的默认目录。

查看的唯一已保存 PNG 为 `native-f92140b8-…-1.png`：实际快捷键设置搜索 `file.new`、创建作品命令及原 Cmd+N 绑定可见。它支持根记录中冲突“跳转查看”后的最终界面；单张图不能证明完整捕获、多绑定/edit 流程、系统 picker、About 或跨 PID 保存。

根记录支持已经执行的有限操作：默认父目录 picker 取消、迁移 picker 取消、头像 picker 取消；公开测试笔名/邮件保存后当前卡片更新；About 命令实际按键捕获、增加 9/8 两绑定、仅编辑第二项为 7；添加 Cmd+N 显示冲突并跳转 `file.new`，原绑定保持。资料和 About 9/7 绑定尚待下一启动读回及恢复，不授持久化 PASS；普通删除/恢复默认、冲突删除再保存/取消分支等未执行。

无模型请求的“取消”实际保留原文本为失败回合和可重试卡，composer 已清空；不能声称取消后原输入框内容保持。modelCount=0 只证明配置列表为空，当前 JSON 没有所有网络/SDK 的全面监听，因此不把它扩为独立监测所得的“所有网络请求为零”或供应商可用性成绩。本轮未有真实模型调用验收。

## 不扩大的结论

三次 owned 成功退出是 80388、81339、82900 的 child exit code 证据，不把它们扩大为全部 OS helper 子进程的完整独立 liveness 审计。81601 只记录根见证的菜单退出与 ESRCH，不拥有退出码；中文 `ps` 过滤可能转义导致漏报，原空过滤不证明没有实例。阶段 41 强止及本轮非 TTY/旧 CUA 目标错误保持历史失败，不能被后一次成功覆盖。

42 的实际系统首菜单显示“玄印写作”而非设计“玄印”，Electron Menu 对象中的 label 不替代 OS 观察；About/version 有限结果不代表全部系统菜单符合设计。该差异由 43 的 shortName 增量单独审核和新包验收，不改写阶段 42 包或本结论。

正式 530 清单继续 not-run；Windows、其它架构、fresh-default/fresh-install、真实供应商/付费网络、全部业务面板、IME、交通灯位置/窗口拖动，以及新跨 PID 的资料/快捷键/草稿/正文持久化均不在本报告 PASS 范围。116/117 仅是前置限定源码/harness 审核，不能与本轮具体运行数量相加成批量正式通过。

118 只新增本报告、保存证据比较程序/结果和一次指纹读回；不改 116/117、旧 freeze、生产、harness 或原始 native JSON。所有输入与 derived result 的具体 SHA/bytes 见 `review118-02-readback.json`。
