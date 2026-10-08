# 用户资料编辑与头像接线独立代码审核

日期：2026-10-07（Asia/Shanghai）。审核者：独立子代理。范围：`ProfileSettings.tsx`、SettingsDialog 的用户分类与关闭挂载接线、`saveDesktopProfile` 共用状态队列、DesktopApp/SidebarTree 对已确认用户的显示，以及main/preload/shared IPC与全局头像资源scheme。头像解码、私有文件及资源生命周期另见审核41。未修改实现、未运行Electron或操作系统文件选择器。

## 结论

**本批用户编辑组件及已实现的资料/头像main接线限定代码审核通过。** 独立执行头像核心18项、真实main-handler受控接线6项、资料组件8项，共32项全部通过，0失败/取消/跳过，退出码0；证据 `docs/evidence/implementation-04/profile-review-green.tap`。这是源码和隔离运行证明，不是完整桌面验收。真实系统picker、BaseUI原生焦点/Tab、两主题及窄窗最终像素、Windows和安装包仍需后续实际验证；不把模型11组冒烟或浏览器原型算作本批资料验收。

## 实际发现与闭合

| 编号 | 来源及缺陷 | 当前复核 |
| --- | --- | --- |
| PR42-01 | 抽取的旧真实组件已有文字草稿，但保存走普通settings update；缺头像选择、会话取消/乱序隔离和保存锁。独立组件初轮5项全部行为失败，`profile-settings-review-red.tap`，没有把缺模块/导入错误当RED。 | 新session及明确save-profile事务；文本/头像仅草稿，保存失败保持两者；显式X、取消、对话框关闭与unmount清会话；保存禁止重复并冻结字段。现8项组件全部通过。 |
| PR42-02 / AVR41-01 | 未选头像的编辑会话main尚未begin；cancel未知session被忽略，队列里的文字保存后到达仍能begin。独立真实service RED，见41。 | unknown取消按owner记有界retired，不可复活；实际main handler测试1先cancel→save拒绝，零写入/发布。 |
| PR42-03 | save-profile先await repository.read，之后才begin；renderer导航/关闭在该await中cancelOwner抓不到尚未登记的保存。独立源码发现，修复后实际handler回归，不宣称留有修复前GUI现场。 | 首个await前登记，read后、persist后/CAS前核验；测试2暂停read并cancelOwner，拒绝且零提交。 |
| PR42-04 / AVR41-02 | 新选损坏图片失败，UI仍显示原有效A，但资产服务已清A，保存DRAFT_UNAVAILABLE。独立真实资产RED及批准原型对照，见41。 | 保留A至新B实际解码成功，失败可保存A；组件测试7和资产15通过。 |
| PR42-05 / AVR41-03 | 两次系统picker请求，旧picker晚返回A；UI代次已忽略A，main按返回顺序仍将A覆盖新B，使可见B不可保存。独立执行真实registerIpc回归6项5通过/1失败，`profile-ipc-review-red.tap`。 | main在弹picker前调用beginSelection，带冻结序号stage；旧读在新picker开启时取消。实际handler乱序回归通过，作者AV17/18覆盖新picker取消保留旧有效草稿。该乱序是受控picker回执，不冒称真实OS曾复现。 |
| PR42-06 | 用户卡头像恒64/编辑按钮默认32、模型行无窄窗80规则，与批准v0.11参数不同。独立CSS源码发现。 | 按稿补常规72/窄64头像、34px铅笔按钮，语义背景/浅阴影、长文本省略及完整title；模型86/窄80与对应留白。源码已复核，真实最终矩形/像素仍待验收，不用CSS镜像测试代替。 |

## 已核对行为与边界

- 用户卡读取已确认store，笔名/邮件只在本次profile草稿变化；头像按钮可访问且打开main picker。左头像与右侧笔名/邮件保持左右及表单高度关系，模型表单规则未影响此布局。无自动更新/重试更新文字，保存失败仍直接再次点保存。
- 保存用真实 `settingsSchema.shape.user.safeParse`，拒绝空/超过80字笔名及无效邮件，合法笔名规范trim、邮件可空。受控测试使用真实schema，没有stub验证规则。保存前复制资料，save-profile与设置/模型共用revision队列；avatarDraftId是main暂存标识，公开确认资料仅为assetId，不将两者混为同一个ID。
- 选择头像仅显示main规范化的data URL；UI自己的session+sequence隔离晚到成功/错误，第二次读取结果先到仍保留第二次。取消选择/替换错误保留旧有效预览；新图片读取期间保存禁用。四种取消路径清session并调用cancelAvatar，晚到旧session不能覆盖重开的新笔名和头像。
- saving同步ref锁和禁用控件防重复保存、修改/选图与内部取消。外点关闭设置立即卸载ProfileSettings，清会话，不能让退出动画保持旧请求有效。已经开始的原子提交不由UI伪造回滚；未入main或未开始CAS的取消按会话拒绝。退出/崩溃flush及物理磁盘持久性仍另需验证。
- 子框显式X可访问，finalFocus为原用户编辑按钮；源码体现分层和返焦意图，受控UI primitive不实现BaseUI focus manager，所以不声称实际Tab陷阱、Escape或返焦已原生验收。实际对话框onOpenChange(false)的取消回调和unmount清理已受控执行。
- main的chooseAvatar参数仅UUID，无renderer文件路径；actual trusted校验窗口、主frame及xaanink://app来源，preload仅导出明确choose/cancel方法。picker拿到的本地路径仅main流向资产服务；窗口导航/renderer消失/销毁按owner取消。
- save-profile是严格envelope，当前avatar身份须匹配确认资料；普通update禁止绕过用户资料事务。main先persist规范化资产，再以CAS确认资料，成功才send新state并清本次draft；CAS失败不发布笔名/头像，原资料继续生效，同draft可重试且不会增加多个资产副本。可能留下尚未引用的完整资产供重试，不宣称无孤立文件或已完成清理/迁移。
- 资料成功后Profile卡、DesktopApp原DashboardShell/SidebarTree账号触发器与菜单均读取新确认值。头像URL为受控UUID的本地 `xaanink://asset/global`，损坏/缺失显示原首字回退；原工作台保持local-author稳定ID，没有为资料变更换编辑器key。这里对工作台保持是源码复核，不借此宣称草稿/undo的资料场景已真实测试。
- scheme仅GET/HEAD、固定global UUID路径，拒绝query/凭据与任意路径；源文件读取限界/符号链接保护来自41。响应为image/png、nosniff、禁止活动内容的CSP；本次对scheme接线是源码检查，尚未在Electron真实图片加载中执行负例。

## 证据精度与未验收范围

`tests/unit/profile-settings.test.ts`运行真实TSX，控制React hooks、UI primitives和IPC。初轮5/5行为RED；最终8/8通过。覆盖文本/头像草稿、失败重试、保存冻结、取消/X/对话回调/unmount、乱序和跨会话晚到、真实schema校验。opaque预览夹具只用于组件显示/选择契约，不是有效图片解码证明；真实解码属于41。

`tests/unit/profile-ipc.test.ts`从当前main源码AST提取真实registerIpc与trusted函数、执行其实际注册的handler，未复制业务实现。使用受控ipcMain/native dialog/repository和真实AvatarAssetService临时文件。6/6通过：取消先登记、owner在await中消失、picker取消后晚路径不读文件、sender/frame/资料越界拒绝、CAS失败后同头像重试单次发布、旧picker乱序不覆盖新draft。receiver/event对象与CAS拒绝由受控依赖提供，不宣称真实Electron权限、实际repository磁盘CAS或原生picker实测；main受控CAS与41真实资产文件分别证明各自边界。

独立最终合跑上述2文件及头像18项为32/32，Node24.18.0。最新全量TypeScript检查曾退出2，错误仅在另批进行中的task-defaults/model-defaults（TS2499及缺ModelService.defaults）；该次未报本批新测试错误。此前整仓tsc0不能代替最新全量通过，待另一批完成后统一复核。

真实macOS/Windows系统文件选择、物理按键和IME、真实BaseUI层级焦点与外点命中、长笔名卡片/两主题/窄窗最终矩形、资源URL实际解码、重启资料恢复、安装包与正式顶层用例完整覆盖尚未由本报告证明。没有读取用户真实头像、将原型证据合并或给正式总例标通过。
