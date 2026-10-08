# 桌面版调研

日期：2026-10-06。来源基线：`mySingleLive/xuanxiang.ink@55a62560dc4818143469abb12717a23c752ade8c`。

后续决策（2026-10-07）：本页保留调研阶段的SQLite推荐及历史状态。用户批准UI后，技术方案基于原数组/JSON/事务/外键完整复用选择**PGlite内嵌PostgreSQL WASM + Prisma**，不运行数据库服务或监听端口；已通过技术审核23。最终实现以 `04-technical-design.md` 为准，兼容性必须通过随后TDD契约，不把研究结论当运行验证。

## 1. 调研结论

推荐 **Electron + Next.js 静态渲染端 + React 19 / TypeScript / Tailwind 4 / 现有组件 + 本地服务层 + 内嵌 SQLite**。现有服务层迁入桌面本地进程，界面与本地进程通过受限 IPC 通信。最终安装包包含运行所需资源；作者不安装 Node.js、数据库、Docker 或服务端，也不启动本地 HTTP 服务。

这不是直接给网站加壳：现有鉴权、数据库、API 路由、模型配置和流式对话均含 Web 服务端依赖。需要保留创作领域规则，替换其部署、数据和通信边界。具体架构与实现契约在 UI 审核后写入技术方案。

目标仓库已存在、为公开空仓库，连接器返回管理员及推送权限。CLI 的 `gh` 认证失效，后续提交可使用现有 GitHub 连接器或可用的 Git SSH 通道；无需因此阻塞设计。

## 2. 现有项目事实

根单体仍包含完整应用；`frontend/` 和 `backend/` 是拆分中的副本。桌面版以根单体作为功能与视觉基线，避免从尚未完成的裁剪副本继承缺失能力。清单见 `source-inventory.json`。

| 部分 | 现状 / 证据入口 | 桌面影响 |
| --- | --- | --- |
| 技术栈 | `package.json`：Next 16.2.10、React 19.2.4、Prisma 7.8、AI SDK 7 | 保留 Web UI 与领域技术；新增 Electron 与 SQLite 适配 |
| 数据 | `src/lib/db.ts` 使用 `PrismaPg`、`DATABASE_URL` | 不能沿用 PostgreSQL 连接；本地内嵌存储需自动初始化与迁移 |
| 鉴权 | `src/app/dashboard/layout.tsx` 依赖 Auth.js 服务端 session | 桌面直接进入本地工作台，移除账号/登录/套餐依赖 |
| AI | `src/lib/ai/provider.ts` 读取平台 AIModel、套餐、平台解密和默认回退 | 所有 AI 分支改为本地模型配置，不允许回退平台模型 |
| UI | `DashboardShell`、`SidebarTree`、`ChatPanel`、`ContentTabs` | 原布局、拖拽比例、草稿、面板显隐和内容 Tab 行为要复用 |
| 创建作品 | `CreateNovelDialog` 挂起草稿，首条发送才建书 | 新增目录指定与本地创建回执；保留向导单页及不自动发送 |
| 正文写入 | `content-commit.ts` 校验版本、幂等、快照、定稿和候选边界 | 保留事务语义；不能用简单文件覆盖代替 |
| PG 特性 | advisory lock、`FOR UPDATE`、部分索引、Prisma JSON 等 | 逐个转换为 SQLite 事务/约束；不能机械换 provider |
| 文本 UI | `MarkdownEditor` 与本地 Monaco | 保留预览、分屏、评论锚点、冲突草稿与本地资源加载 |
| 视觉 | `src/app/globals.css`、`Seal`、`public/brand/*.svg` | 原语义令牌与温玉 SVG；不另起桌面视觉体系 |
| 字体 | 当前根布局用 `next/font/google`，有本地 Noto Sans SC 资源 | 安装包包含字体与许可证；运行时不能联网下载字体 |

领域面板包含：作品/封面、主题与设定、世界/地图、角色/弧线/属性、物品/等级、场景/图像、爽点泪点、世界线、叙事线、大纲、正文、候选稿、伏笔、情景试验场、创作流程/任务/活动、评审与子任务。全部创作能力属于迁移范围，不将首版缩减为单一 Markdown 编辑器。

服务端归属约束在桌面本地服务层继续执行，以作品 ID、已授权目录、实体关系和事务边界替代多用户部署上下文。去掉远端登录不意味着渲染进程可以任意读写路径。

## 3. 可行路线比较

| 路线 | 优点 | 不符合要求或成本 |
| --- | --- | --- |
| Electron 载入线上 Web | 复用最快 | 依赖远程服务端、账号和平台模型；排除 |
| Electron 打包 Next 服务端 + PG | 较少重写 | 服务端与数据库部署/维护负担；PG 不适合无部署本地 App；排除 |
| Electron 内置 Next HTTP 服务 + SQLite | 业务迁移较易 | 额外端口、生命周期及本地服务面；与完全无服务端的目标不一致，不选 |
| Electron + Next 静态 UI + IPC + SQLite | 保留 UI 技术栈；无监听端口；离线管理作品 | 需明确拆开 API 适配层、流式 IPC 与领域事务；推荐 |
| 全量重写为其他桌面 UI | 可原生交互 | 不满足 Electron + 原 Web 技术栈及 UI 一致要求；排除 |

Next 静态导出不支持依赖请求的动态服务端逻辑，不能照搬 API handlers、cookie/session 与 Server Actions。此处安装的 Next 文档不存在，已查官方静态导出说明。后续改构建配置时优先读取新项目安装的匹配版本文档。[Next 静态导出](https://nextjs.org/docs/app/guides/static-exports)

Prisma 官方列出 SQLite 支持，但 PostgreSQL 原有 SQL 和模型约束仍须逐项迁移；是否继续全部使用 Prisma、以及原生模块打包方式，在技术方案中验证后定案。[Prisma SQLite](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite)

## 4. 桌面窗口与视觉

产品采用无传统边框/标题栏的窗口，顶部新增窄标题带。macOS 保留系统交通灯；Windows 使用 Electron 的原生 Window Controls Overlay，置于右侧。标题带提供拖拽区域，交互按钮排除拖拽，预留系统按钮安全区。系统窗口控件在设计稿中仅作示意，真实行为需 Electron 与原生输入验收。[自定义标题栏](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)、[拖拽区](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)

主体复用 Web 三栏。初始只显示侧栏 + 对话；打开内容时出现第三栏；设置从原侧栏底部设置入口打开独立应用内设置面板。标题栏不是新的业务工具条，不添加重复模型选择、作品选择或上下文指标。

原有 `paper` / `ink` 色值、纸纹、墨石纹理、字族和 SVG 资产直接取基线。最终使用原 React 组件；设计稿是新增桌面差异的审核媒介，不能作为逐像素一致的测试替身。

## 5. 本地数据与目录

默认应用数据根目录：macOS 为 `~/.xuanxiang/`，Windows 为 `%USERPROFILE%\\.xuanxiang\\`。设置允许迁移此目录。该目录管理应用配置、作品索引、模板、密钥密文、日志和全局恢复信息。

每部作品必须经原生目录选择器指定独立目录。作品目录持有身份 manifest、数据库、附件、快照和备份；全局索引只保存作品 ID / 路径 / 最近打开信息，不能使作品正文只存在全局目录。这样移动整部作品目录后可重新关联或导入。

SQLite 是随安装包运行的内嵌数据引擎，无独立数据库服务。WAL 与备份需正确处理侧文件和一致性；作品默认使用本地磁盘，网络共享/云同步中的活跃数据库需明确限制与验证。[SQLite WAL](https://www.sqlite.org/wal.html)

应用数据迁移与作品目录移动是不同操作：修改应用数据目录不自动搬动作者独立选择的作品。迁移需暂停写入、保存草稿、一致性复制、校验、提交新路径并能在失败后回滚。恢复快照存于新根，成功后清理旧根中本应用管理的数据文件，保留目录本身和未知文件；默认位置只留最小引导指针与恢复记录。清理失败单独提示，不冒充完整迁移成功。执行前由作者审阅实际清理范围。

## 6. 用户模型与安全边界

- 默认没有可调用模型，也没有内置 Key。支持作者登记 OpenAI 兼容、OpenAI Responses、Anthropic Messages 等适配端点；DeepSeek、GLM 等兼容模型按用户配置使用。
- 所有正文、评审、摘要、抽卡、图像、子任务及重试只解析本地模型记录；能力不支持时明确停止，不能转平台服务。
- 联网仅用于作者主动配置并调用的模型接口（含本机接口）。应用无平台服务、遥测、登录、自动更新检查或远程资源加载。AI 本身可联网的例外来自用户 API Key 要求，不等同访问 Web 平台服务端。
- Key 使用操作系统保护的加密能力，macOS 对接 Keychain、Windows 对接 DPAPI；渲染端只得到掩码与配置状态，不能通过读配置取回明文。跨机器迁移作品不包含密钥。[safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- 渲染进程隔离、禁 Node 集成、受限 preload、IPC 参数与来源校验、Markdown 清洗、路径授权与导航限制进入后续技术/测试清单。[Electron 安全](https://www.electronjs.org/docs/latest/tutorial/security)

## 7. 验证与交付风险

| 风险 | 后续验证方式 |
| --- | --- |
| 大范围创作业务迁移遗漏 | 面板/工具/写入操作清单一一映射，审查无空壳和远端依赖 |
| PG 到 SQLite 行锁与幂等丢失 | 并发写入、重放、冲突、候选批准、定稿、历史回滚测试 |
| UI 复用中意外改版 | 同数据的 Web/桌面两主题对照，确认允许差异区域 |
| 崩溃、断电、目录不可写导致丢稿 | 故障注入、强制结束 App、重启、恢复草稿和事务一致性 |
| Electron 下 Monaco/流式对话失效 | 打包后的真实窗口编辑、输入法、取消、迟到流隔离 |
| Windows 只能画外观未真实运行 | Windows 真实 runner/机器执行，缺证据不可通过 |
| 安装包只是启动开发服务器 | 断网、未安装 Node/PG 的干净机器安装并打开 |
| 调用真实模型产生费用 | 作者提供验收用端点/Key 并明确调用授权，测试预算在后续用例注明 |

Electron 官方支持 Playwright 驱动真实 Electron 程序。可自动化输入和检查窗口，再补原生交通灯、拖拽、输入法等系统交互；浏览器原型测试不能替代桌面验收。[Electron 自动化测试](https://www.electronjs.org/docs/latest/tutorial/automated-testing)

## 8. 进入下一阶段

调研结果用于产品设计。产品设计先经子代理审核；随后 UI 文档与可交互设计稿经子代理审核、用户审核。尚未开始技术方案、测试用例或 App 代码，避免绕过用户指定顺序。
