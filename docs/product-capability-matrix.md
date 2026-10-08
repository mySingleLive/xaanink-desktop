# 产品能力矩阵（产品设计组成部分）

<!-- USER-2026-10-08-CANCEL-BACKUPS CURRENT-SCOPE BEGIN -->
> **当前范围（2026-10-08）：用户取消全部备份功能。** 本矩阵D06“备份/恢复/崩溃”是混合历史行：一致性备份/从备份恢复退役，强制结束后durable草稿及实际数据事务保护保留。D02迁移前额外数据备份快照取消，但journal/指针故障续行保留；X05事务快照、X08原ID回收恢复等创作能力不退役。矩阵Dxx编号不能和requirements-traceability.json桌面Dxx误合并。
> 活动清单：[acceptance-active-scope.json](acceptance-active-scope.json)；原文和退役明细：[backup-scope-retirement.json](backup-scope-retirement.json)。此处不声明实现完成或验收通过。
<!-- USER-2026-10-08-CANCEL-BACKUPS CURRENT-SCOPE END -->

基线提交：`55a62560dc4818143469abb12717a23c752ade8c`。所有下列条目均须迁移并在后续测试用例映射；表中“验证操作”定义产品能力，不是提前产出的测试用例文档。技术/实现/测试状态目前全部尚未开始。

## 完整内容 Tab 清单

| ID | 原 Tab / 面板 | 必须保留的能力与验证操作 |
| --- | --- | --- |
| C01 | story-workflow | 创作阶段、资料关联、作者认可、阶段重开与任务进度 |
| C02 | story-review | 检查点/整书评审、评分、意见、再次评审与原稿保护 |
| C03 | story-activity | 任务与执行活动、状态/回执、失败恢复 |
| C04 | novel | 作品概览、改名、信息保存、打开/归档/移除索引 |
| C05 | novel-cover | 自定义图像模型生成、本地导入、裁切与选择封面 |
| C06 | theme | 主题、定位条件、市场评估、作者要求与版本恢复 |
| C07 | world | 世界树、子世界、同作品归属、防环、介绍与地图 |
| C08 | setting | 全部 SettingType：等级/力量/概念/金手指/文风/地图/势力/社会/文化/地理/历史；作用域与分类 |
| C09 | attributes | 定义/值/类型、实体属性编辑、删除影响与关联 |
| C10 | characters | 角色列表、排序、创建/删除及引用 |
| C11 | character | 身份/外在/心理/能力/弧线/关系；别名/动机/信念/五维/标签/对话风格；链式弧线与人工值保护 |
| C12 | character-image | 头像/立绘的生成、导入、裁切、选择与历史 |
| C13 | items | 物品列表、分组及等级筛选 |
| C14 | item | 物品属性、归属、等级、创建/修改/删除与引用 |
| C15 | item-image | 物品图生成、导入、裁切及选择 |
| C16 | scenes | 场景列表/层级、创建、排序与归属 |
| C17 | scene | 场景设定、关联人物/物品、空间关系及修改 |
| C18 | scene-image | 各场景图类型、生成/导入/裁切、关联 |
| C19 | trope | 爽点/泪点模板、选择、自定义创建/删除及编辑 |
| C20 | worldline | 结构化世界线、事件、关联实体、保存与版本 |
| C21 | narrative | 叙事线、卷章结构、字数预算、提案/批准/变更 |
| C22 | outline | 大纲投影、卷/章节层级、只读提示与叙事线跳转 |
| C23 | chapter-outline | 章纲投影、批准边界、关联任务与正文 |
| C24 | chapter-content | MarkdownEditor 预览/编辑/分屏、自动保存、冲突、历史、锚点评论、定稿 |
| C25 | chapter-candidate | 抽卡组、选卡、预览全文、改稿、批准替换、撤销替换、字数门槛 |
| C26 | cascade | 连锁影响评估、修订任务、作者批准与跨实体一致性 |
| C27 | subagent | 应用内 AI 子任务（与开发子代理不同）、模型继承/撤销、执行状态与回执 |
| C28 | scenario | 情景试验场、演员/场景、轮次/分支、控制/停止/继续、保存与恢复 |
| C29 | foreshadow | 伏笔、角色关系、正文引用锚点、触达状态与回收 |

## 跨面板操作与新增桌面能力

| ID | 能力 | 操作边界 |
| --- | --- | --- |
| X01 | 初始两栏与展开三栏 | 侧栏/对话/内容显隐、拖拽、全屏、窄窗切换和布局恢复 |
| X02 | 会话与输入 | 新会话/切换/删除、标题、草稿、原子引用 chip、拖入/点选实体、剪贴、组合输入 |
| X03 | 流式 AI 生命周期 | 发送/提问/队列/停止/错误/重试/恢复、切换会话、迟到片段隔离 |
| X04 | 原向导与聊天建书 | 四环节模板、过滤/标签联动、详情、拼贴、不自动发送、延迟建书回执；startNovelFromChat 同样先取得作者目录授权，不允许 AI 静默选默认路径 |
| X05 | 原稿保护 | 版本 CAS、幂等写入/重放、事务快照、候选/批准/定稿、撤销与恢复 |
| X06 | 评论与评审 | OPEN/AGREED/APPLIED/REJECTED 状态、引用/全局评论、锚点失效、应用/拒绝/撤回与缓存刷新 |
| X07 | 三阶段保存 | 临时修改/暂存/提交、撤销、跨实体修改及面板状态恢复 |
| X08 | 聊天资料回收 | 回收影响预览、作者确认、原 ID 快照恢复与位置冲突 |
| X09 | 四格式正文导出 | 单章/整书 TXT、Markdown、DOCX、PDF；中文字体、标题/序号、封面、格式与原生保存位置 |
| X10 | 图像与附件 | 本地导入/用户模型生成、响应资源本地化、引用与作品搬移后仍可读 |
| X11 | 模板/提示词 | 离线内置库、本地自定义、修改保护、导入导出；不含在线管理后台 |
| D01 | 目录与离线创建 | 显式目录授权、原向导目录行、人工建书、打开/失联/重新关联/移动 |
| D02 | 应用数据根迁移 | 默认两系统目录、目标检查、暂停/校验/提交/清理/恢复与快照 |
| D03 | 用户模型设置 | 文本/文生图分组模型列表，两类选择与路由隔离；按输出能力筛选的彩色供应商菜单/完整目录、预设仅Key与列表、自定义接口字段、无分类/用途字段；保存模型/测试连接/取消，草稿隔离/Key保护、直接批量测试/加载禁重复/结果弹层/取消隔离/显式撤销、全部AI分支本地解析 |
| D04 | 通用/用户/UI/快捷键/关于设置 | 除用户资料/模型配置外有效变更实时更新；用户资料独立草稿，保存提交，取消/X/Escape 丢弃、失败保留/重试；本地头像/笔名/邮件；三种主题模式及两套色板/缩放/文字/布局；快捷键搜索/冲突/IME；真实版本、用户主动反馈、文档上线后启用 |
| D05 | 原生窗口与生命周期 | 无独立顶/底栏、全高分栏、两系统控件与栏内导航、拖拽、吸附/全屏、关闭落盘、退出与重新激活 |
| D06 | 备份/恢复/崩溃 | 一致性备份、恢复校验、强制结束后草稿和作品数据恢复 |
| D09 | 智能体默认设置 | 默认文本/审核/文生图取已保存有效对应模型，标准/计划模式，能力约束的思考档位；即时保存/失败重试校验；新任务生效，不改当前会话；引用失效不补位 |
| D07 | 本地与安全 | 全部数据本地、目录权限、导入清洗、无远端平台/端口/CDN/遥测/自动更新 |
| D08 | 独立安装与开源 | 独立源码/构建、许可、三类发行架构、干净机器离线启动与真实目标系统验收 |

## 机器可核对的基线与排除规则

`source-inventory.json` 附全部 29 个内容 Tab、AI `tool()` 定义及共享写工具名单、121 个原 API 路径/HTTP 方法、65 个领域服务和54个数据模型。后续技术方案为这些清单逐项给出「本地迁移入口 / 领域规则复用 / 明确平台专属排除」；测试文档给出用例 ID。最终汇总不得遗漏或用一个冒烟用例代替整组操作。

允许排除的能力：Web 营销页面、在线认证/用户/套餐/平台计费、在线管理员审计与平台模型登记、远端部署工具。管理员里的模板/提示词功能与模型配置能力必须以本地用户设置方式保留，不能随管理后台整体丢弃。API 路径是原能力盘点入口，最终 App 不运行这些 HTTP 路由。

新增能力若改变此矩阵须更新产品/技术/测试映射并复审。当前为产品范围基线，尚无实现或验证结果。

## 全部 AI 工具的产品能力归属

共 98 个工具定义，逐项映射保存在 `source-inventory.json` 的 `capabilityIds`。下表覆盖只读与写入工具，不表示已实现或测试通过。

| 能力 ID | 分组 | 原工具名 |
| --- | --- | --- |
| X04/D01 | 作品与建书 | `startNovelFromChat`, `getNovelOverview`, `getNovelContext` |
| X03 | 对话提问 | `askUserQuestion` |
| C06/C07/C08 | 主题、世界与设定 | `getWorlds`, `getSetting`, `upsertTheme`, `createWorld`, `updateWorld`, `upsertSetting`, `deleteSetting`, `deleteWorld`, `assessThemeMarket` |
| C10/C11/C12 | 人物与弧线 | `getCharacter`, `listCharacters`, `createCharacter`, `updateCharacter`, `generateCharacterImage`, `deleteCharacter`, `generateCharacterArc` |
| C05 | 作品封面 | `generateNovelCover` |
| C09 | 属性 | `listAttributes`, `upsertAttribute`, `deleteAttribute` |
| C13/C14 | 物品 | `listItems`, `createItem`, `updateItem`, `deleteItem` |
| C16/C17 | 场景 | `listScenes`, `getSceneContext`, `createScene`, `updateScene`, `deleteScene` |
| C19 | 爽点泪点 | `listTropes`, `createCustomTrope`, `deleteCustomTrope`, `selectTrope` |
| C20/C21/C22/C23 | 规划与大纲 | `getOutline`, `generateOutline`, `createVolume`, `updateVolumeOutline`, `createChapter`, `updateChapterOutline`, `approveOutline`, `getNovelPlanning`, `getNarrativeChapter`, `proposeNovelPlanning`, `applyNovelPlanningProposal` |
| C24/C25/X05 | 正文候选与定稿 | `getChapterContent`, `checkChapterNarrative`, `getChapterCandidates`, `drawChapterCandidates`, `generateChapterContent`, `improveChapterContent`, `revertChapterReplacement`, `writeChapterContent`, `getChapterFinalizationChecklist`, `finalizeChapter`, `generateStoryChapters` |
| C02/X06 | 评审与评论 | `listReviews`, `getScoreReport`, `requestAIReview`, `requestReaderReview`, `addTextComment`, `listTextComments`, `handleTextComment`, `reviewWholeNovel` |
| C01/C03/C27 | 创作流程与子任务 | `getSopStatus`, `proposePlan`, `createSopPlan`, `updateSopPlan`, `summonPlaywright`, `completeStoryTask`, `requestContentApproval`, `getStoryWorkflow`, `updateStoryWorkflow`, `reopenStoryPhase`, `reviewStoryCheckpoint`, `requestStoryApproval`, `getStoryArtifact`, `linkStoryArtifacts`, `unlinkStoryArtifacts`, `getStoryImpact`, `getStorySources` |
| X08 | 回收与恢复 | `requestStoryRemoval`, `listStoryRemovals`, `restoreStoryStructure` |
| C29 | 伏笔 | `createForeshadowCharacter`, `listForeshadows`, `getForeshadow`, `createForeshadow`, `updateForeshadow`, `deleteForeshadow`, `addForeshadowTouch`, `removeForeshadowTouch` |
| C26/X07 | 暂存与连锁修订 | `analyzeStagedImpact`, `commitStagedChanges`, `triggerCascadeRevision` |

本次修订：D03 模型家族Logo覆盖所有选择/目录列表，智谱改官方黑底圆角图形；D04/D09模型选择边界保持；D04外观分类名及纯图形主题示例；审核工具默认展示仅属设计审核辅助，不新增安装版能力ID。保留前次修订：D03 修正智谱与图形，按类别筛供应商，测试直接逐项执行已选草稿并弹出结果；保留前次新增彩色供应商与完整目录设计、简化预设字段、模型手动保存；D09 智能体默认设置；D04 用户编辑独立草稿，保存后更新，取消/X/Escape 不提交；D05 底部沿用 Web 用户菜单，新增设置并移除旁侧齿轮。其余 Web UI 完全复用，来源绑定见 UI 文档第 8 节。

本轮 v0.9：D03 可用模型搜索下拉/数量摘要、上下文十进制K/M、输出参数隐藏但协议必需字段保留；D04 拆界面/正文、字体/字号/源码行号/默认不换行、完整动作注册与作用域快捷键；D05 两平台应用菜单遵循系统位置与窗口安全区。产品补充见 desktop-menu-shortcut-contract.md，不扩大其他 Web UI 改造范围。

本轮 v0.10 覆盖前版数量/多选描述：D03 添加与编辑模型均单选，测试/保存只作用于当前一个型号；D04 设置统一逐行分组，每命令有序多快捷键集合，可单独添加/编辑/删除，空集合不回退、全集合冲突校验与两平台隔离；D05 菜单显示首绑定并随编辑/删除同步。产品补充见契约 v0.2，未扩大 Web 工作台改造范围。

本轮 v0.11：D03 配置模型全部属性上下全宽、列表卡片增加垂直留白；D04 路径/主题上下结构，用户卡片背景与纯图标编辑入口美化。其他短设置、资料手动保存、模型单选/多快捷键和其他Web UI不变。见产品补充v0.3与UI第11节。

本轮 UI v0.12：D02应用根迁移在系统目录选择确认后才启动，D01默认作品父目录也先选择；D03所有AI执行路径按对应类别/授权/选择门控，首次中央不设添加模型按钮；D04主题为界面首项、设置外点关闭与草稿失效、真实按键录制及冲突取消/原子转移/定位；D05系统菜单关于使用两平台独立原生面板。原型仅演示代表性任务/系统样式，完整能力和原生验收状态不变。详见产品第17节、契约v0.4和UI第12节。

本轮 UI v0.13：D04设置改为纯左右结构，左导航顶部显示设置标题、关闭在右内容右上；右侧重复分类大标题移除，失败/重试与保存提示保留，滚动区域不与固定控件叠加；跟随系统图示去圆形装饰。D05外点、键盘焦点与子编辑行为保持；其他功能未改。见产品第18节、契约v0.5、UI第13节。
