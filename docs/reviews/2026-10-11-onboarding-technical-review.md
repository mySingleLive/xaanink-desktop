# 新手引导技术方案独立审核

日期：2026-10-11。审核人：独立子代理 `/root/onboarding_design_review`。方案作者为主代理；本审核未编写产品实现。

## 结论

**通过技术方案审核，可以进入专项测试用例审核与 TDD。** 本轮发现的身份重试、关闭草稿生命周期及模型确认校验缺口已在技术方案“独立审核修订：身份与关闭”中明确处理，复读最终文本后无剩余阻断。用户已经批准最终 UI，无须再次请求 UI 批准。

这是方案通过，不是产品代码、专项测试或目标系统验收通过。未运行产品测试、渲染、Electron、构建或全量回归；既有 HTML 截图不作为本次产品证据。

## 方法与范围

通过 `Get-Content` 和 `rg -n` 静态核对以下文档及真实代码：

- `docs/reviews/2026-10-11-onboarding-technical-design.md`、产品设计及 `docs/implementation-boundaries.md`。
- `desktop/core/{settings,versioned-store,configuration-transfer}.ts`。
- `desktop/main/{index,model-repository,avatar-assets,business-gate,close-coordinator}.ts` 与 `desktop/shared/{ipc,configuration}.ts`。
- `src/components/desktop/{DesktopApp,ProfileSettings,ModelConfigurationDialog}.tsx`、`src/components/ui/dialog.tsx`、`src/stores/desktop.ts`、`src/lib/desktop/draft-session.ts`。

这里只比较方案与现有可复用机制、识别必须新增的契约；没有把尚未实现的方案描述当成实际行为。

## 发现与修订复核

| 发现 | 真实源码依据 | 最终方案处理 |
| --- | --- | --- |
| 最后一个 receipt 被覆盖后，旧操作不能再次当作新提交；有界指纹若淘汰，会重新允许重复身份；重启后没有秘密 payload 指纹，不能假确认改变后的字段 | `versioned-store.ts:69` 串行 CAS；`model-repository.ts:72` 再次带 Key 会增加 authRevision；`src/stores/desktop.ts:31` 普通写入从最新 bootstrap 生成动作 | 技术方案第35、39行固定首次 envelope/revision/session；4096 身份上限不淘汰、满额拒绝；只允许已知冻结 payload 且匹配最后 receipt 的同步确认，重写当前权威状态；被覆盖旧操作拒绝；重启不恢复 pending，未知旧 confirm 一律拒绝 |
| 新建 creationId 必须与显式编辑区分，碰撞不能变成修改已有模型 | `model-repository.ts:65` 现有编辑依 draft.id 查 prior；`:73` 普通新建由主进程分配 UUID | 第35行要求 creationId 不存在才可新建，碰撞拒绝；编辑必须显式 ID 且存在 |
| 关闭优先级若立即卸载编辑器，会取消头像并丢失失败后的字段，而关闭仍要等待设置队列 | `ProfileSettings.tsx:25` 卸载会 release；`avatar-assets.ts:192` cancel 退役会话；`draft-session.ts:62` 关闭 flushSettings；`desktop.ts:11` 未确认保存阻止关闭 | 第7、31、37行改为隐藏 Popup、阻止新操作并保留编辑器、冻结提交与头像会话；未 replace 的保存可被主进程拒绝，取消关闭后仍保留字段及错误；显式退出/返回才清理 |
| receipt 重试若先进入头像或模型准备，可能被已清理头像会话拒绝，或重复加密/修改授权 | `avatar-assets.ts:73` retired session 拒绝 begin；`model-repository.ts:72-75` 普通准备增加授权/加密 | 第39行要求 receipt 核对先于 avatar begin/assertActive/persistDraft 与模型准备；已提交路径仅同步当前权威状态 |
| 普通 saveModel 接受 draft 的 kind/enabled，不能直接以此保证引导默认模型可用 | `model-repository.ts:73` modelSchema 接受 enabled:false；`settings.ts:12` kind 由 draft 指定 | 第41行要求新建、编辑、选用三个分支都依据主进程当前步骤验证 kind，并要求 enabled:true；已保存 ID 消失准确报错 |

## 已确认的实施约束

- 完整与短流程触发依真实 TEXT 数量；停用 TEXT 仍算记录，已有配置不清空。步骤、返回、完成与默认用途以主进程状态校验，完成后才展示欢迎。工作台与编辑器继续复用真实组件（方案第7–13、19行；`DesktopApp.tsx:93` 初始化握手及`:160` 既有对话框入口）。
- 资料、模型、默认用途及进度采用一个 VersionedStore CAS 替换；TEXT 同时绑定 text/review，IMAGE 绑定 image；两处跳过只完成进度并保留原图片设置。不能串接普通 saveModel/update。现有 `atomicWrite` 在 rename 后可抛 `CommitDurabilityError`，现有 repo 已重读并发布授权，方案扩展了真实失败后的 renderer 留页与幂等同步契约（`versioned-store.ts:33-36`、`model-repository.ts:44-52`）。
- 顶层 onboarding 兼容旧 state，且普通保存/删除必须保留。当前 save/remove 构造 `{settings,models}` 会遗漏新增顶层字段，方案明确必须改；严格配置 snapshot 必须显式投影，导入不得覆盖本机进度（`model-repository.ts:81,90`、`configuration-transfer.ts:65-70`、方案第17行）。
- 新 IPC 复用 businessHandle，但须另做当前主窗口/主 frame、ready draft session、closing/quitting/迁移/lease 及异步后、beforeRename、返回前的准入复核。现有 trusted 仅证明调用来源，BusinessGate 仅控制准入和 drain，两者都不能代替这些复核（`index.ts:112,323,464`、`business-gate.ts:8`、方案第29行）。
- Key 留在加密模型字段与必要内存；进度/receipt/public 状态无 Key 或派生摘要。字段错误须控制脱敏，模型确认不访问 provider。目录/测试迟到结果取消和身份检查独立于保存结果；隐藏不等于主动退出。
- 专项自动测试、相关旧用例和真实 Windows Electron 证据需独立执行。类型检查与构建不代替业务验收；无真实输入法/系统 DPI 或原生选择器证据时据实保留限制，不做全量回归（方案“验证与范围”）。

## 短流程接口附录复审

主代理在本审核后补充的“实施接口附录”也已静态复读，结论仍通过。`start-models` 单独 CAS 将完整已完成状态切至短流程 text，保留 completed=true 及图片/默认配置；full 未完成时拒绝，不允许客户端 expectedStep 决定模型类型。入口收到成功 acknowledgement 才显示文本表单，失败留入口并保留同一冻结 envelope。主动再次进入可以重新 start-models；已删除的引导 TEXT 引用仅清除引用，不删除记录或改默认、不自动选用后备。

completed 在此表示完整引导已完成，故短流程 text/image-choice/image 与 completed=true 必须作为合法 schema 状态。严格 selection 联合明确区分 existing、新建 creationId 与编辑 id，拒绝未声明字段；新建/编辑共用现有白名单与凭据 scope 校验。新的入口事务和上述状态组合必须在后续专项单元与真实 Electron 中覆盖；本复审未执行这些用例。

下一审核阶段须把上述已修订边界列为明确失败注入与状态断言，再以真实实现结果复核；本文件不声明这些断言已经通过。
