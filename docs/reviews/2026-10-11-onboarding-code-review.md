# 新手引导独立代码审核

日期：2026-10-11（Asia/Shanghai）。结论：**通过本次新手引导的独立 code review，无未解决的阻断项。** 依据已批准的最终 UI、产品设计、技术接口及专项用例核对实现；早期发现已经修复并有相应断言。本结论限定本次功能及直接关联路径，最终组合验收由主代理负责。

审核者没有编写或修改产品实现、测试及台账；本轮仅新增本记录。采用源码与 diff 审核、独立限定复跑、主代理执行证据核对和本地截图目视检查，没有运行全量回归或操作用户浏览器。

## 源码核对

| 契约 | 已核对来源与结论 |
| --- | --- |
| 首次、未完成恢复、零 TEXT 短流程 | `src/lib/desktop/onboarding-flow.ts` 与 `DesktopApp.tsx`：缺标记/未完成进入 full，completed 且没有 TEXT 时提示；停用 TEXT 仍按存在处理。普通设置、空态和缺模型入口有同步 ref 去重；`start-models` 成功 ACK 后才显示短表单，未完成 full 不能被短流程跳过。 |
| 顺序、复用与确认语义 | `OnboardingController.tsx` 依真实进度按主题→资料→TEXT→图片询问/可选 IMAGE→欢迎推进；主题独立 Dialog，资料复用抽出的 `ProfileEditorDialog`，模型复用原编辑器。按用户后续批准统一“继续”；普通设置保留“保存/保存模型”。真实 `DashboardShell` 和业务组件没有被原型替换。 |
| 默认用途及两处跳过 | `desktop/main/model-repository.ts:123` 的单次 CAS 同时保存模型/默认用途/进度；TEXT 同时绑定 text/review，保留 mode 和兼容 thinking，IMAGE 绑定 image 后完成。询问与表单的 skip 不新增模型、不覆盖已有 IMAGE/default。回退编辑保留确认 ID，缺失 ID 要求显式重新选择。 |
| 身份与失败重试 | `src/stores/desktop.ts` 首次入队固定 revision/session/operationId/payload；controller 仅 ACK 后推进，错误校准不会当成功。repo 先验 receipt/内存指纹再准备模型/头像，同 receipt 重写最新权威状态验证同步，不再创建/加密/增加 authRevision；被覆盖 receipt、未知重启身份、改变 payload 和 creationId 碰撞拒绝。4096 身份容量不淘汰，满后拒绝新身份。 |
| 主进程准入与错误保护 | `desktop/shared/onboarding.ts` 严格 action/schema；`desktop/main/index.ts` 真实 handler 绑定当前窗口、主 frame、ready draftSession，拒绝关闭/quitting/迁移/lease/gate。service/repo 在异步资源后、beforeRename 和返回前复核；模型类型由磁盘步骤导出且必须启用。固定安全错误不回传 Key、Zod payload 或系统 cause。 |
| 关闭、高优先级与异步结果 | `DesktopApp.tsx:178` 隐藏引导保留组件和内存字段；store 写队列参与既有关闭 flush。保存锁阻止返回/退出/跳过，测试 operation 与保存锁分离，可取消测试；迟到 finally 不能解锁新的 save，目录迟到回复不能回填。 |
| 头像竞态 | `ProfileSettings.tsx:48` 的 hide 发送当前已接受 draftId；preload/shared/main 桥一致。`avatar-assets.ts:106` 最多保留已接受 A 和候选 B；选择 epoch 在 IPC 接收时同步分配。取消选择既使 queued/pending B 失效，也能在 B 已处理而 UI 未接受时恢复 A，不退休整个 session；真实 service/IPC 专项验证 A 仍能保存。 |
| UI、焦点与安全显示 | `DesktopApp.tsx:51` 检查旧焦点 connected/可见后返回，否则依可见账号、紧凑导航、消息输入框回退。controller 的 step key/initialFocus 保证欢迎标题聚焦。拼贴原生 button 与页脚调用同 action；CSS 保留 pointer、缩放/衬底/楷体、focus-visible/reduced-motion，没有移动光带。React 文本渲染真实笔名，80 字换行；不创建作品或调用 provider。 |
| 保密与兼容 | `desktop/core/settings.ts` 进度只含步骤/ID/receipt，无草稿或秘密摘要，旧 marker 缺失兼容；模型准备复用原保护通路，公开模型没有 Key。`configuration-files.ts` 仅投影可迁移字段，导入保留本机进度，普通 save/remove/update 保留它。`limitedRead` 增补 Windows symlink 与打开前后文件身份核验。 |

## 发现及修复闭环

早期审核发现的主题写失败仍可继续、资料 Back 提前退休头像、确认 ID 丢失后静默新建、恢复入口 ref 不同步、模型 public 字段误入 draft、隐藏后的旧测试解锁新操作，均已在最终源码及对应用例中修复。

后续三个阻断已闭环：新模型 post-rename 后 bootstrap 已含同模型时，本地 duplicate 检查挡住重试，现用 `onRetry` 越过草稿/Key/头像会话校验直接重试原 envelope；连接测试期间无法取消，现退出/dismiss/返回/跳过可用；头像 B 晚到覆盖界面保留 A，现用已接受 draftId 恢复 A，覆盖 queued 和已 staged 两个时间窗口。

验证真实性也已修复：native close 超时不再强制结束后算通过；等待背景账号入口明确 includeHidden，正常交互仍用真实可见定位；HTTP 审计包装每次 webRequest 注册，不能被产品的后注册替换。实际短窗口焦点失败已修产品并在真实窗口复跑通过。旧模型服务测试改为有界 fetch 入口事件等待，未改产品服务迎合测试。

## 独立执行结果

Windows、Node v24.19.0，在仓库根实际执行下列 **11 个限定文件**，退出码 0，**99/99 通过，0 失败/取消/跳过**：

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --import tsx --test --test-isolation=none tests/unit/onboarding-repository.test.ts tests/unit/onboarding-service.test.ts tests/unit/onboarding-ipc.test.ts tests/unit/onboarding-controller.test.ts tests/unit/onboarding-flow.test.ts tests/unit/onboarding-store.test.ts tests/unit/onboarding-editors.test.ts tests/unit/onboarding-retry-integration.test.ts tests/unit/avatar-assets.test.ts tests/unit/profile-ipc.test.ts tests/unit/profile-settings.test.ts
```

包含真实 TEXT/IMAGE 编辑器→controller→串行 store→真实文件 repo 的 post-rename 重试组合断言，两例均确认原 envelope、一次加密、一个模型及仅 ACK 后推进；受控 React hooks/界面 primitives 不证明 native DOM/focus。另独立执行 Node24 `node_modules/typescript/bin/tsc --noEmit` 及 `git diff --check`，均退出 0；diff 仅有 Windows 换行转换提示。

## 组合与实际系统证据复核

| 主代理实际执行证据 | 独立核对的结果及边界 |
| --- | --- |
| [scoped-tests.json](../evidence/onboarding/scoped-tests.json) | 一条完整命令 20 个直接相关文件 189/189，exit 0、0 skip；没有全量入口。我的 99 次复跑是其子集，不与 189 相加。 |
| [实现](2026-10-11-onboarding-implementation.md)、[验证](2026-10-11-onboarding-validation.md) | 记录 Next 生产构建/main-preload-service 构建 exit 0、Windows 包 317 资源验证；构建不算业务用例。 |
| [windows-electron.json](../evidence/onboarding/windows-electron.json) 与 `scripts/smoke-onboarding.mjs` | 真实 Windows 编译应用 8 组场景，0 rendererErrors；关闭重开、恢复弹窗暂停/字段恢复、真实持久化/双用途、两处 skip、图片 Enter/Space、欢迎与退出焦点、Tab/ShiftTab、800×600/150% app zoom、80 字署名均有实际断言。启动前 main+实际 worker guard 加载 8 次，审计尝试 0；6 类 TCP 参数预检，调试端口明确排除。 |
| [windows-package.json](../evidence/onboarding/windows-package.json) | 实际 `玄印写作.exe` 同 8 组通过，app.isPackaged/appPath 被断言，main/preload/service/PNG SHA 与编译应用一致。4 次启动 Node main Server 监听快照均 0；启动后 main/renderer guard 加载 4 次、尝试 0。package 的 preEntry=false、serviceWorker=false 明确记载，不据此宣称包冷启动全进程网络抓包。 |

独立目视编译应用 `01-theme-paper.png`、`02-theme-ink.png`、`03-image-hover.png`、`04-welcome.png`，以及包 `package-01-theme-paper.png`、`package-04-welcome.png`：标题/主按钮可见、三主题缩略图/选中状态清晰、图片配置文字无截断、欢迎署名按文本显示，没有模型/Key 摘要。其余布局/键盘断言来自实际脚本，不把旧 HTML 预览图算产品验证。实际 Electron 与 package 是主代理运行；审核者复核源码、JSON 和上述截图，没有独立再启动这些应用。

物理 IME、系统 DPI/多屏、原生头像选择器人工操作、macOS、NSIS 安装及真实供应商连通未执行。composition 是合成事件；app zoom 不等于系统 DPI；头像解码、持久化与取消覆盖来自真实文件服务/IPC 专项。包冷启动网络/worker 审计范围按报告限制保留；历史失败记录不是通过证据。本审核不扩大旧业务验收、不宣称全量回归通过。
