# phase15 本地模板与提示词作者交接

状态：作者实现与 79 定向修订完成，等待独立复审最终结论；本报告不自评 PASS，不提升正式 DESK/业务清单的跨平台验收状态。v1 冻结和历史日志保留；以下初版记录与末尾 v2 修订分开说明。

## 改动与理由

保留原 Web 提示词管理、变量高亮、表单/创建/删除交互；增加来源、另存为和客户端版本 CAS。新管理 Dialog 使用原 UI primitives，将创作模板管理和导入预览承载在同一窗口。原创作向导仅更换本地语料读取/错误/刷新裁剪，布局、过滤、详情、拼贴及由作者手动发送保持原语义。

全局离线库复用 PromptTemplate/ContentVersion/SystemConfig，无新增数据库部署或远端后端。默认 seed 精确 hash 保护自定义/停用版本；单条修改和全批导入均原子保存条目、历史及 metadata CAS。导入先完整校验和只读预览，保存才执行；导出仅模板白名单。渲染提示词继续原缓存合同，并在成功保存后立即清缓存。

精确合同见 [template-library-contract.md](../evidence/implementation-15/template-library-contract.md)；作者源码/测试及主代理接线的观察 hash 见 `template-library-frozen.json`。主代理入口依赖不在本子代理编辑范围，后续如其变化须重新核对接线，不能用旧 hash 宣称当前整个 App 已审核。

## TDD 与修复历史

| 证据 | 实际结果与归属 |
| --- | --- |
| 01 domain RED | 15/15 行为失败：缺本地库实现，保留日志 |
| 02 首次 domain GREEN 尝试 | 14/15，副本 ID 碰撞返回错误 code；修复先判碰撞再规范化内容 |
| 04 dispatcher 首轮 | 原夹具 D06 在活 context 内关库导致释放错误，不把该夹具失败归为产品 RED |
| 05 dispatcher 纯 RED | 1 PASS/5 FAIL，D06 原全局归属已通过，其余真实 CAS/本地管理/导入/取消尚缺 |
| 06 首轮 React RED | 缺 UI 导致失败，同时下载 waiter 夹具提前建立出现异步警告；保留日志 |
| 09 React 纯 RED | 8/8 行为失败，无夹具异步警告；随后 10 的 8/8 GREEN |
| 11 wizard RED | 1 PASS/5 FAIL，四个原向导本地库行为缺失及保存 A 迟到回执切回 B 的实际问题 |
| 12/13 首次向导实现尝试 | Hook 误放 TemplateCard，浏览器/类型失败是作者实现错误；移到 CreateNovelDialog |
| 14 后续尝试 | 11/14，向导浏览器夹具缺原 CSS，BaseUI inert 层挡点击；补编译真实原样式，不强制绕过点击 |
| 15/17 刷新 RED | 首六向导 GREEN；新增第七证明已停用卡片仍保留旧详情。17 先等实际卡片列表更新再断言，仍 0/1 FAIL |
| 18 最终 React | 15/15，停用选择/详情裁剪及其他 UI 行为全部 GREEN |
| 19 最终 domain/dispatcher | 21/21，无 fail/skip/cancel，exit0 |
| 20/22 React 与视觉 | 20 的 15/15，22 单项实跑在主题过渡结束后重拍原 paper/ink/390 窄窗截图；默认测试不覆盖截图 |
| 24 字段草稿 RED | 0/1，切换模板/重新新建后旧逗号输入残留，UI与已保存数据不符；重置字段输入草稿 |
| 25 最终 React | 16/16，含原8管理与8向导/创作模板 |
| 26 最终全量类型 | exit2，唯一诊断为其他范围 `tests/unit/image-resource.test.ts:127` 的 `events.once` namespace 类型；本批源码/测试零诊断，已交主代理协调，不能据此声称全量 tsc 通过 |

domain 原测试不调用或仿造供应商；真实 PGlite 事务/历史/CAS 的证明与受控浏览器 UI 证明分别记录。取消回归在最终事务 guard 注入取消，证明提交前整批 rollback；不冒称任意时刻物理断电或真实 Electron 关闭已经测试。

## 覆盖映射与审核重点

- `TPL15-01…15`：原 seed/401 卡片、幂等启动、单条 CAS/旧版本、变量、另存、默认升级保护、内置删除保护、白名单导出、非法导入、只读预览/keep/copy/replace、库 CAS、提交前取消、创作模板语义/停用、批次原子性。
- `TPD15-01…06`：保留 admin prompts GET/POST/PATCH/DELETE 兼容边界、新 wizard/import/export 本地命令、取消及全局而非作品归属。
- `TPU15-01…08`：实际原提示词编辑器与变量高亮、保存期间新输入、内置另存、导入取消、显式冲突替换、失败重试、关闭重开迟到回执、实际 Blob 下载。
- `WZU15-01…08`：实际原向导本地卡片详情/拼贴、原频道过滤/停用、读取错误/重试、pending 阻断、完整 WizardTemplate 副本、保存 A/B 竞争、库更新清理停用选择及详情、切换/新建清理已丢弃的逗号字段草稿。

关联正式要求 DESK-B08/SCN-X11、API-admin_prompts-GET/POST、API-admin_prompts_id-PATCH/DELETE、模板管理能力 X11。以上是当前分层回归证据，正式文档 status 仍由整体验收者按真实平台步骤判定。

建议独立 reviewer 定向检验模板库 CAS/hash/来源与历史、取消后事务、portable schema/凭据白名单、原变量缓存、多窗口/迟到输入/预览、原向导消费及主代理菜单/启动接线；可新增自己的独立测试，不改作者断言。作者源将冻结；实际缺陷由作者定向修复，再出新版本保留历史。

## 实际限制

本批未执行真实 Electron 菜单打开→worker→重启的联合场景、真实系统文件对话框、实际磁盘写入故障/断电、Windows 或安装包验收；浏览器 file input/下载是实际 Chromium，API 为受控 local 响应。原模板文本可由作者自定义，导出会保留其原文；没有自动扫描用户文本替换内容。当前 portable schema 为 v1，超规格文件/未来版本明确拒绝并保留原库。v1 类型结果为 26 日志中的其他范围诊断，v2 最新类型结果见 38；不将不同时间的结果混称。

## 79 审核定向修订（v2）

独立 reviewer 的真实 RED 指出三个边界缺陷，作者仅修改 `render.ts`、`PromptsClient.tsx` 与 `template-dispatcher.ts`；不改独立断言、main、restore、工作台或模板领域模型。

- TPL79-01：原变量读取允许原型方法/继承值。改为 `Object.hasOwn` 和字符串校验，空字符串保持有效，缺失和非字符串统一拒绝；作者新 TPL15-16 实际 PGlite 用例先 RED 后 GREEN。
- TPL79-02：新建回执无条件关闭/清表单/改选择，覆盖取消后的 B 或在途新文本。创建携不可变请求、草稿引用、epoch 和原选择；旧窗口/新选择没有 UI 所有权。同 Key 的新名称/正文接到新行的未保存编辑草稿，沿用回执版本，再次保存才写新文本。Key 已改保留新表单。作者 TPU15-09 取消后原样重开、TPU15-10 后续文本实际显式保存均先 RED 后 GREEN。
- TPL79-05：未知 GET 先读空 JSON 导致 400。先匹配允许的路径/方法，未知命令明确 404，既有合法写入错误保持原语义。

| 修订证据 | 结果 |
| --- | --- |
| 27/28 独立测试作者复现 | 域 3 PASS/2 FAIL；React 0 PASS/2 FAIL，保留实际旧源 RED |
| 29/30 作者新增 RED | 各 0 PASS/1 FAIL，分别为 owned/string 与创建 epoch |
| 31 域相关合跑 | 作者 16 domain + 6 dispatcher + 独立 5 = 27/27，exit0，无跳过 |
| 32 首次 React 尝试 | 18/19；独立 U02 的等待点被合法 BaseUI inert 阻挡，该等待夹具问题不列为新产品缺陷，数据断言由 reviewer 保留并校正等待 |
| 34 新文本转编辑 RED | 0/1，作者补验证回执后仍能按新行 v1 显式保存新文本 |
| 35 修复后 React 合跑 | 作者 10 管理 + 8 向导 + 独立 2 = 20/20，exit0 |
| 36 全量类型 | exit0，空诊断；旧 v1 26 的外部诊断已由其作者解决 |
| 37 最终 React 合跑 | 按独立 reviewer 固定的等待修订执行相同 20 项，20/20，exit0，无跳过 |
| 38 最终全量类型 | 在独立测试等待修订稳定后重新核验，exit0、空诊断 |

当前作者 40 项，独立 7 项，相关合跑 47 项。独立 reviewer 负责 79 最终结论；作者运行其测试不替代独立复验。v2 清单单列独立测试 SHA，保留 v1 及全部 RED，不改变前述 Electron/Windows/完整 App 未验收边界。
