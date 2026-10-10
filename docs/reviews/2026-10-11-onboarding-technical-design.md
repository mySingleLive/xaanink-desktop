# 新手引导技术方案

日期：2026-10-11。UI v3 已由用户明确批准，包含最后一次移除图片移动光带的修改。本方案及测试用例已通过独立审核，当前处于实现、code review 与专项验证阶段；最终结果另列验证记录。用户要求只运行本目标相关测试，覆盖旧约定的全量回归要求。

## 接入与复用

真实 `DesktopApp` 在 `DesktopDraftSession.initialize` 成功后取得 bootstrap。此后仲裁引导：启动错误、writer lease、关闭、迁移、草稿恢复优先；引导开启时关闭普通设置、模板和缺模型对话框并阻止重复入口。使用 ref 同步阻止同一事件循环的重复打开。高优先级流程只隐藏当前Popup、阻止新操作，保留编辑器与冻结提交、头像会话；取消目录/测试，忽略迟到结果。已入队保存必须先确认或报错，关闭取消后恢复当前字段和错误；显式返回/退出才卸载清草稿，进程终止由owner清理。真实窗控、DashboardShell 和全部业务组件继续使用原组件。

新增 `OnboardingController` 管理完整、短流程、短提示及欢迎页，纯路由函数判定启动条件，严格以 TEXT 记录数量（包含停用记录）判断缺模型。完整流程缺标记或未完成时自动启动；完成且零 TEXT 每个 renderer 会话提示一次。设置通用区提供“继续新手引导”，模型文本空态提供“开始模型引导”；缺文本模型提示的配置动作复用入口，不重发请求。有 TEXT 的错误沿用现有精确修复入口。

从 ProfileSettings 抽取 `ProfileEditorDialog`，原编辑入口继续手动“保存”，引导传入“填写用户信息 / 继续 / 返回”及原子提交回调。头像的选择、预览、会话、取消、落盘复用 AvatarAssetService。ModelConfigurationDialog 增加可选引导提交回调、标题、返回/跳过、继续按钮及已配置模型单选区；普通设置行为仍为保存模型。所有表单均不使用 submit/Enter 隐式提交。无效字段聚焦并显示 alert。模型测试结果仍说明测试未保存。

主题独立 Dialog 使用原生 radio 与抽象工作区示意，三卡各高180px，宽800px。文生图询问640px，使用已批准本地PNG，移入 public/onboarding 作为离线静态资源；native button 与页脚共用接受动作，保留缩放/衬底/楷体文字，无移动光带，focus-visible、减少动态效果及 disabled 都覆盖。欢迎560px，品牌印记复用现有资源，真实笔名按 React 文本渲染，不创建作品。

## 数据与事务

`state.json` 顶层增加可选 nullable `onboarding`，不加入 Settings。旧文件缺字段等价于 null，默认仍无模型；schemaVersion 不变，严格验证新字段。记录仅含版本、completed、最近步骤、已确认 TEXT/IMAGE ID、最后成功 receipt（UUID及操作类型/模型ID）；不保存草稿、Key、供应商输出或 Key 派生摘要。publicState 同步该状态，正常模型保存/删除必须保留它。配置导入/导出边界明确投影 revision/settings/models，避免 strict snapshotSchema 拒绝新增字段；导入保留本机进度。

新增 `desktop/shared/onboarding.ts` 的严格判别联合 action：主题选择、主题继续、资料确认、模型确认（新建/编辑或选用现有的单选）、图片接受/跳过、相邻返回。每次携带 revision、真实 draftSessionId、flow、稳定 operationId；新建模型另外携带稳定 creationId。完整流程校验当前相邻步骤，禁止从资料直接完成；短流程只能在完整引导完成后使用，TEXT 首步无返回。已有模型须存在、启用、类型相符，删除/停用后不能偷偷换首项。返回已确认步骤保留同一模型ID，未提交字段只存在编辑器内存。

ModelRepository 新增单次CAS提交：读取并校验当前状态 → 准备安全模型或资料 → 更新默认用途与进度 → VersionedStore.update 一次原子替换 → publish 授权。新文本确认设置 textModelId 和 reviewModelId；保留 mode，与新模型兼容的 thinking 保留，不兼容时沿用现有 default 回退。图片确认设置 imageModelId 并完成；跳过仅写完成记录并保留已有图片默认。资料保存与步骤前进同一次替换；头像资源先安全落盘，然后写引用，失败不会引用缺失文件，取消不删除已提交配置。

复用现有安全模型准备逻辑：主进程保护 Key、端点及字段校验、凭据 scope 改变必须重新输入、blank Key 同scope保留、变更授权撤销、重复模型判断。不能 saveModel 后再 updateSettings。模型操作确认不调用 provider。

每次逻辑确认的 payload 和 UUID 在 renderer 内存固定，失败保留字段并复用相同身份重试。VersionedStore 可能 rename 成功后抛 CommitDurabilityError；repo 先重读磁盘并同步授权，客户端也重读 bootstrap，但不得因错误跳到成功页。重试在校验权限后核对最后成功 receipt：相同操作已提交时，用最新 revision 原子重写当前权威状态以重新确认同步；不重新创建模型、加密或增加 authRevision，不覆盖后来配置。若同步仍失败继续报错。不同身份依据最新 revision/步骤提交。相同操作身份不得携带改变的 payload；主进程当次生命周期保留有界的内存指纹校验，不将秘密或派生摘要写入进度。收到权威确认后才显示下一步/欢迎，关闭重启则恢复磁盘真实进度。返回或改动字段开始新的逻辑确认，不复用旧 UUID；密钥不会进入 receipt。修订冲突必须留当前页，不覆盖其他设置。

## 主进程准入与异步清理

新 IPC `desktop:onboarding` 通过 businessHandle，绑定当前 BrowserWindow/webContents 和已ready draftSession；关闭、退出、迁移、businessGate、lease阻塞均拒绝。读前、头像异步后、版本替换 beforeRename 以及返回前再次复核同一 owner/session；不能只信任 renderer disabled。头像仍使用独立编辑 UUID，与工作台 draftSessionId 区分。字段错误只返回可控脱敏消息，避免 Zod/系统 cause 或 draft 内容出现在产品日志/错误。

前端引导写入走现有 desktop store 的串行 writes 队列，flushDesktopSettings 纳入关闭屏障。每次操作捕获身份防重复点击；保存期间阻止返回/退出/跳过/原生 Escape。关闭窗体先flush，原生关闭流程优先。测试与目录读取沿用operation UUID与alive检查，返回/切步/退出/被高优先级遮挡时取消；迟到回复不能恢复已卸载表单或显示成功。高优先级隐藏时不取消正在提交的头像会话；显式返回/退出才清理头像。主题即时保存成功前阻止继续，写失败保留真实主题和错误；跟随系统保存system值。

## 独立审核修订：身份与关闭

每个 renderer 逻辑确认在首次进入串行队列时固定完整 envelope，包含初始 revision 和 session；重试不得根据bootstrap校准重新生成revision。匹配最后receipt才进入权威状态重写确认；receipt被后续动作覆盖后，旧revision必须拒绝，不把旧请求当新动作。内存操作身份/指纹集合上限4096，不淘汰；满时拒绝新操作并给出重新启动提示。字段变化需新的明确确认身份。进程重启后不恢复未确认payload/Key，按磁盘进度恢复；若主动核对最后receipt，只能另用不含user/model draft的元数据路径；本实现无需此路径，未知旧confirm一律拒绝。未匹配最后receipt的旧请求仍受固定旧revision和相邻步骤约束。新建creationId必须不存在，碰撞拒绝；编辑必须显式id且存在，不能用creationId冒充编辑。

关闭事件可以使尚未replace的写入在主进程准入复核失败；这时编辑器继续保有字段、payload和头像session，flush失败交由现有原生关闭协调决定重试/取消。隐藏不能被算成用户主动退出，不能清Key或销毁正在等待确认的草稿。

receipt核对先于模型准备/加密与头像begin/assertActive/persistDraft。已确认资料的头像session可以已retired，重试仍可确认权威状态。同进程内存指纹能证明冻结payload时，直接重写当前state；重启没有待重试草稿，因此未知指纹的旧receipt confirm一律拒绝（包括改动非秘密字段），客户端按磁盘步骤恢复，不把新秘密draft误称已保存。

所有模型确认分支（新建、编辑、选用）都由主进程当前text/image步骤导出期望类型，并要求模型enabled为true、kind匹配；不能仅依靠draft.kind或普通saveModel的准备逻辑。返回后的已保存ID如消失须准确报错，不自动重新创建。

## 实施接口附录

`desktop/shared/onboarding.ts` 导出 `OnboardingAction`（完整IPC envelope）、`OnboardingPayload`（由store补入revision/sessionId前的动作）及严格schema。桥接为 `DesktopBridge.onboarding(action: OnboardingAction): Promise<StateSnapshot>`，通道 `desktop:onboarding`。所有动作的共同字段为 `revision: number`（非负安全整数）、`sessionId: UUID`（bootstrap的真实draftSessionId）、`flow: "full" | "models"`、`operationId: UUID`。首次进入串行writes队列时冻结完整envelope；失败重试复用原revision、sessionId、operationId及所有payload。动作schema拒绝未声明字段。

| type | 动作额外字段 | 主进程前置步骤与结果 |
| --- | --- | --- |
| `theme` | `theme: "paper" | "ink" | "system"` | full的theme；即时保存主题，step仍theme；首次完整引导记录由此或next-theme建立 |
| `next-theme` | 无 | full的theme；step变profile |
| `profile` | `user: Settings["user"]`、`avatarSessionId: UUID`、`avatarDraftId?: UUID` | full的profile；先复用独立头像编辑会话写完整资产，再同CAS保存user及step=text；未选择新头像时保持既有avatarAssetId，拒绝客户端伪造资产引用 |
| `start-models` | 无 | 仅flow=models且完整引导completed=true；同CAS置step=text、保留completed=true和IMAGE/default；已确认TEXT引用若已删除则清空该引导引用，不删除模型、不修改agent默认；成功后才显示短流程TEXT表单 |
| `model` | `selection`，定义见下文 | 仅diskstep=text或image；预期kind由diskstep导出；text成功同CAS设置文本/审核默认、linked TEXT ID及step=image-choice；image成功设置图片默认、linked IMAGE ID及completed=true、step=welcome |
| `image-choice` | `choice: "configure" | "skip"` | configure仅diskstep=image-choice，置step=image；skip可在image-choice或image，保留已有IMAGE/default并同CAS完成到welcome |
| `back` | 无 | full相邻返回profile→theme、text→profile、image-choice→text、image→image-choice；models仅image-choice→text或image→image-choice；welcome/theme及models的text拒绝 |

`selection` 是单选严格联合：`{ type: "existing", id: UUID }` 或 `{ type: "draft", model: ModelDraft, creationId?: UUID }`。existing必须仍存在、enabled=true、kind与diskstep匹配，无需Key或复制模型。draft的新建（model.id缺失）必须携带稳定creationId且任意已有model均不得占用该ID；编辑（model.id存在）禁止creationId，必须找到原记录、kind匹配且enabled=true。编辑已确认步骤使用disk linked ID，不凭重试新增。ModelDraft自身使用现有StoredModel字段白名单去掉id/authRevision/encryptedKey/keyMask，再仅加入可选id及apiKey；所有凭据scope与原保存校验保持一致。

flow=full只用于缺标记或未完成的完整引导；flow=models不能替代尚未完成的完整流程。短入口每次先提交start-models，失败留在入口并保留冻结envelope；用户主动重开可再次start-models重置为text，自动入口/空态仍由前端严格零TEXT记录判断。此动作解决completed=true、step=welcome时没有可从磁盘导出的TEXT步骤的问题，model无需再接受客户端expectedStep。

成功返回完整public StateSnapshot（含nullable onboarding），由相同state事件广播；错误只给固定安全消息。onboarding-service先核对owner与receipt，再做头像/model准备；receipt重试重写最新权威AppState确认同步，不再执行动作、不增加authRevision。真正动作检查原revision和合法步骤后才准备数据，并在最后rename前复核owner/ready/关闭准入。返回成功才允许前端推进；bootstrap失败校准可更新实际设置，但不能替代本次成功acknowledgement。

## 验证与范围

## 实施审核补充：未收到确认的已提交操作

发生写后同步错误时，只有错误操作 UUID 与权威 bootstrap 最后 receipt 匹配才冻结表单、选项、返回、跳过及测试；普通写前错误或 revision 冲突仍允许改字段。继续按钮调用专用 `onRetry`，直接重放 Controller 内存中的原 payload/envelope，跳过编辑器的重复模型、Key及头像会话前置校验。这样新建模型已经出现在 bootstrap 或头像会话已清理时仍能确认原提交。确认成功前仍停留原页，显式退出允许丢弃未确认内存并在下次按磁盘进度恢复。

高优先级隐藏资料编辑器时通过窄 IPC 取消该会话当前头像选择 epoch，保留已 stage 的头像草稿；主进程在打开选择器前及异步返回后校验，迟到选择不能覆盖先前草稿。模型连接测试与保存使用不同的锁：测试期间返回、跳过、退出可取消请求；保存期间阻止这些动作，旧测试 finally 不能释放后续保存锁。

最终头像协议显式传UI已接受draftId，分别保留已接受图与当前候选图（最多两张）。即使新候选已经stage但回复尚未被UI接受，暂停取消也恢复旧图；取消不会退休整段编辑会话。退出焦点目标必须仍可见；紧凑窗口侧栏隐藏时回到可见工作区导航，不能只凭账号元素isConnected。

## 验证执行

ONB-01…11 专项测试用例已完成独立审核。先新增失败用例再实现，主代理负责组合，后端与前端按文件范围分工，独立审查不得审核自己编写的实现。新单元测试针对 schema/状态/原子事务/权限/失败注入/导出兼容，必要关联模型、资料、settings flush/default snapshot 测试限定文件执行。真实 Windows Electron 使用已有 Playwright Electron CLI 与隔离 XAANINK_TEST_ROOT，离线验证完整流程、短流程、关闭重开、键盘、图点击/悬停/减少动态效果、短窗与缩放；截图只含合成测试资料并在填Key前拍摄。浏览器模拟不是目标系统验收，旧HTML截图不是产品测试。

构建与 typecheck 检查变更可装载，不等于全量业务回归。不运行全量 npm test，不访问真实供应商，不修改父仓库，不引入HTTP监听服务，不把查看器审核工具或示例工作台写入产品。台账在每阶段据实际命令和证据更新，不改写历史验收。
