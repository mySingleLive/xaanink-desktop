# 作品目录、授权与本地身份独立代码审核

审核日期：2026-10-07（Asia/Shanghai）。范围限定 `desktop/service/workspaces.ts`、`desktop/main/directory-authority.ts`、`context.ts` 新增 `allowNovelCreation`、`src/lib/services/novel-create.ts` 目录门控、`src/lib/auth.ts`、`desktop/handlers/admin/lib.ts` 身份适配，以及 `workspaces.test.ts`、`directory-authority.test.ts`、`original-content-service.test.ts` 的相关回归。只修改本审核文件，没有修改实现或测试、没有审查正在开发的其他 IPC/main/model 文件。

**最终结论：通过（本批限定范围）。** WS01–08均已修复并经独立复审闭合，没有剩余阻断项。最终15项隔离测试、限定源码及测试的类型检查通过，无失败/跳过/取消。普通打开已停止抢占过期目录锁；完整 App 的显式锁恢复、原生目录对话框及全局实例锁仍须在后续接入并验收，本记录不把这些能力计为完成。

## 发现及闭合

| 编号/原严重程度 | 独立复现与影响 | 修复与验证 | 状态 |
| --- | --- | --- | --- |
| WS01 · P1 | grant 消费后只保留裸 path。消费选中目录授权，再把该目录改成指向未选目录的 symlink；create 成功在未选目录写入 manifest、database、assets、snapshots、backups。 | consume 返回 canonical/dev/inode 的 DirectoryProof，worker 入队后及创建副作用前重新核验。新增真实消费后换目录回归拒绝且未选目录无 manifest。 | 已关闭 |
| WS02 · P2 | create → run 留下池中连接 → open 同一作品，被自己的目录 lease 拒为“其他进程打开”。 | 同一目录 open 复用已有 slot 并验证原小说；retiring Promise 避免淘汰未关完时重开。已有真实重开场景增加池中 open 成功 oracle。 | 已关闭 |
| WS03 · P2 | initialize 先写 catalog/marker 再加载缺失迁移资源；资源恢复后重试因缺 inbox 失败，留下无法正常完成初始化的应用根。 | 先验证资源；owned marker 采用 initializing→ready，可幂等完成目录初始化。inboxReady=true 时丢失数据库仍拒绝重建，避免空库覆盖真实数据。缺资源恢复及已初始化库丢失回归通过。 | 已关闭 |
| WS04 · P1 | A 读取死 lease 后停在 readdir 返回处；B 真实回收并持有 PGlite 连接；恢复 A 后盲 rename 删除 B 新 live lease，A 也成功借库。B 关闭报锁归属变化，两个真实连接已失去排他保护。 | 普通打开不再自动回收 stale 锁，完整保留 owner 和数据，并提示需要受控恢复。新增真实 stale lease 内容不变/借库拒绝回归通过，不用 pathname rename 伪装 CAS。 | 已关闭（普通打开安全边界）；显式恢复留后续阶段 |
| WS05 · P2 | 新库迁移失败留下 phase=creating 的作品，catalog空；修复迁移后同请求重试拒非空，open要求并不存在的恢复副本。owned inboxReady=false 的首次迁移失败后，重试也因没有 local-author 而无法完成。 | manifest 保存 requestHash；同请求可续建 creating 或已提交未索引状态，UUID保留；local-author 用幂等 upsert，未 ready inbox可续初始化。两种真实迁移失败→恢复回归通过，后加入的 author.txt 完整保留，inboxReady只在实际完成后置true。 | 已关闭 |
| WS06 · P2 | 成功创建后移动原目录、在同路径建立新空目录，用新有效 proof 重放同 requestId/title，旧代码返回原id“成功”，但当前目录为空。 | 重放分支核对原 dev/inode、manifest作品/小说ID、ready及数据库路径。新增同路径替换重放拒绝且不新建 manifest 的 oracle通过。 | 已关闭 |
| WS07 · P2 | 延迟真实 pool engine.close：第一 close尚未完成，第二 close即返回并将closing=false；新run进入，被尚未释放的自身lease拒绝。 | close共享实际完成Promise；等待所有 disconnect settle，失败slot保留以重试；关闭期间拒run。持久回归检查同Promise与关闭门；独立真实 engine.close gate+故障注入另确认等待、失败保留slot/lease、成功重试关闭并解锁。 | 已关闭 |
| WS08 · P2 | 四个真实作品已入池，增加inbox触发第五槽淘汰；最旧engine.close故障后，slots/retiring都删除其记录。同作品retry被自身live lease拒，随后的manager.close返回成功，但旧engine及owner.json仍保留。 | 失败retirement必须保留slot/cleanup句柄并可重试；重新借库和close都不能忽略未真正关闭/解锁的旧连接，不可误报全部关闭。 | 已关闭：failedRetirements保留失败slot；run拒绝重用，close等待全部retiring后实际重试清理；五个真实库回归确认owner移除及再次打开成功 |

所有发现即时发送主代理后再复审。只有有证据的问题进入上表；一项创建期间注入 database symlink 的额外探针被拒绝，没有把未观察到的跨目录写入当作发现。

## 关键独立证据

WS04 在隔离目录使用两个真实 Workspaces/PGlite 实例。先使 A 已观察死 owner；在准确 gate 处让 B 建立新 lease 并保持其数据库 scope 活动，再恢复 A。旧实现得到 `AOpenedWhileBActive: 1`、B token被替换、B解锁报归属变化。不是只伪造 live pid 或由定时器猜测数据库是否打开。修复后的普通打开在 stale 判定即拒绝，保留旧 owner 字节，不再进入危险 rename 分支。

WS05 的旧实现输出为：`phase=creating`、同请求 retry“需要空目录”、open“请从恢复副本恢复”、catalog为空。inbox旧重试输出“初始化未完成，请恢复数据”，marker仍false。修复回归使用相同合法 checksum 的失败 SQL与完整上游迁移，观察相同作品UUID、只有一个小说、用户文件保留及inbox完成标记，而非清空失败库后重建。

WS07 最终独立探针将真实池中 engine.close延迟并第一次抛错；断言两个 close是同一Promise、期间均不完成、run拒绝。释放gate后关闭拒绝，但slot及owner.json仍在；去掉故障后重试成功，slots清空且owner.json确实移除。整个探针只操作临时目录，未读取作者真实作品。

WS08使用四个实际建书目录及一个实际inbox，只有最旧engine.close故障注入；manager API的观察值为 `tracked=false`、`retiring=false`、重借“其他进程打开”、manager.close成功但 `leaseStillExists=true`。探针保留连接引用进行最终清理，没有让故障连接泄露到真实作者目录。该结果不否认WS07普通close失败重试的修复，而是淘汰分支仍提前删除owner。

最终修复后新增同一真实五库回归：第一次淘汰关闭失败，旧slot存入failedRetirements且重借明确拒绝；close重试该真实engine并解锁，owner.json实际移除；之后原作品可重新打开并查到一个小说。独立运行该用例及本批全部限定测试通过，WS08闭合。

## 正确行为与范围边界

每个作品显式选择目录，创建目录非空且没有匹配创建journal时拒绝；重开验证 regular manifest、数据库目录/PG_VERSION、UUID与目录身份；复制同UUID作品要求重新关联，不静默克隆。两个作品的原完整schema数据真实隔离，重启后catalog和小说保持。pool不会淘汰活动scope，close共享实际完成，失败淘汰仍保留实际清理句柄，只有成功关闭/解锁后删除所有权跟踪。

DirectoryAuthority按purpose、owner、有效期和一次消费管理grant，错误purpose/owner不取得目录权限；选择路径变化和撤销owner都使授权不可用。DirectoryProof是受信主进程到worker的边界载荷，未来dispatcher仍必须由native选择签发/消费grant，不能接受renderer伪造proof；本批没有执行真实native对话框或渲染器攻击验收。

本地auth只在受信DB context内返回固定local-author/USER，不读取外部请求头；无context为null。原小说归属仍校验，foreign-author作品返回403。requireAdmin的适配允许受信本地设置/模板操作，但不把创作身份改为ADMIN；这不是Web平台管理授权。allowNovelCreation只在已授权作品创建过程开启，普通作品scope不能隐式再建书；已验证DIRECTORY_REQUIRED错误和数据库未新增小说。

同轮新增的globalDatabase/runWithGlobal只定向核对默认createScopedClient目标仍为request、普通run保持作品DB context；本批现有隔离/身份/正文回归仍通过。没有将尚在接入的全局模板/业务路由全部纳入通过范围。

升级前快照代码只在本批观察其不绕过原迁移与数据路径边界，不宣称完整根迁移、资源校验备份/恢复或跨引擎版本恢复已验收。普通打开对过期锁的保留是安全修复，后续显式恢复仍必须实现，不能把“拒绝恢复”算作崩溃恢复用例通过。跨平台文件身份、全局实例锁与sessionData顺序、原生关闭/目录选择均保留到对应阶段。

## 独立验证

```sh
node --import tsx --test tests/integration/workspaces.test.ts tests/unit/directory-authority.test.ts tests/integration/original-content-service.test.ts
```

指定Node24.19.0：初审9/9；首轮修复11/11；WS01–07修复14/14；最终WS08修复15/15（8项作品目录、3项目录授权、4项原服务/身份），全部无跳过。WS06/WS07是现有顶层叶测试内的新增oracle，不另虚增测试数。

类型检查使用临时tsconfig继承仓库基础配置，include明确为本范围六份实现及三份测试，让TypeScript检查其传递依赖；各次修订后及最终检查均通过，临时文件清理，没有新增仓库配置或把该结果称为全量App typecheck。

已核对 `docs/evidence/implementation-01/workspaces-review-red.tap`：三项真实失败为池中重开、自 grant消费后换目录未拒绝、资源修复后缺inbox；旧RED保留。其余发现的独立gate/故障注入行为及修复结果如上，不伪称每个子oracle都有单独RED日志。531条正式顶层验收用例和真实Electron/双平台验收状态不由本审核推进为passed。
