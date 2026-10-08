# 本地模板与提示词库独立代码审核（79）

日期：2026-10-08。审核者：product_revision_review；实现作者：product_review。

结论：**限定 PASS**。三类有实际行为证据的问题均已修复；当前审核范围未发现剩余阻断。独立复验47/47通过、无跳过，全量TypeScript检查退出0。此结论不替代真实Electron菜单、重启、Windows、安装包或全部531顶层用例验收。

## 范围与冻结核验

读取phase15合同、20份作者文件，定向核对35份只读依赖中的本地受信身份、global inbox数据库、worker启动seed、`file.templates`静态命令、主进程受信命令分支、Controller与DesktopApp管理窗口入口。没有修改生产实现、作者测试或原模板语料。

作者v2清单为`template-library-frozen.json`，聚合SHA256为`12d3b911dd7a228d3ca6cab83b35f9a9ea46bddd08454a96c3ad3221ba7ddf5e`（顺序20份文件的path:sha256，LF且含末LF）。独立核对20作者文件、2独立测试、35依赖、45证据全部匹配，聚合一致；结果保存在[指纹核验](../evidence/implementation-15/review79-13-final-manifest.json)。旧v1清单及所有RED保留。只读入口快照不是对其它main/备份/图片邻接代码的扩大审核。

## 发现与关闭证据

| 发现 | 严重度 | 真实行为与修复结论 |
| --- | --- | --- |
| TPL79-01 继承属性被当作模板变量 | P2 | 在真实PGlite中创建包含toString/constructor/__proto__的合法模板，空变量对象原先输出原型方法/对象。现在只接受自有字符串值，缺失或非字符串拒绝；显式自有字符串与作者新增空字符串回归通过。独立RED为04日志。 |
| TPL79-02 迟到创建回执夺取编辑目标或丢新输入 | P2 | 实际React/Chromium中，A创建挂起时取消、转到B写草稿，旧回执原先跳回A；同创建窗口继续输入的名称/正文也被清空。现在回执检查创建epoch、原草稿与选择；取消/重开/切换使其失效。同Key的新文本保留为已创建行的未保存草稿，以真实回执版本再次显式保存；改变Key保留新创建表单。两项独立原RED在03日志，最终两项GREEN；作者补充同form取消重开及v2显式保存回归。 |
| TPL79-05 未知GET被错误要求JSON请求体 | P3 | 受信本地未知GET原先返回400，违背404合同。现在先匹配合法path/method，再读取写命令body；未知GET安全404，合法坏body仍拒绝。独立原RED为05日志，最终通过。 |

没有把夹具问题记为产品缺陷：02日志的无身份探针起初包含requestSchema拒绝的伪造header，改为合法空header后实际403断言通过；07日志及作者32日志中U02等待底层可访问按钮遇到BaseUI合法inert，只调整等待真实已提交数据和React结算，保留当前新输入/未自动提交的数据oracle。11全量类型尝试失败仅来自在途image80独立测试的Response(Buffer)夹具，修正后12全量检查无诊断。

## 独立验证及数据边界

再次运行真实隔离PGlite全迁移及LocalDispatcher的27项（22作者、5独立），[09日志](../evidence/implementation-15/review79-09-final-domain-green.tap)为27/27。实际React19/BaseUI、原Button/Dialog、原Web向导和真实ChromiumDOM的20项（18作者、2独立），[10日志](../evidence/implementation-15/review79-10-final-ui-green.tap)为20/20。两次测试退出0、取消/跳过均0；[12全量类型记录](../evidence/implementation-15/review79-12-final-typecheck.txt)退出0且为空。Node24命令与结果单列于[独立摘要](../evidence/implementation-15/review79-14-final-summary.json)。

独立域探针还确认：混合导入前两行已修改/新增、末行副本ID冲突时，条目、历史与库revision整个事务回滚，显式修正后保留本地版本和user来源；缺元数据的旧内置默认、已编辑且停用的旧行经两次seed仍保留原内容/停用/version；没有受信数据库身份的请求无法导出。原401张创作卡片直接复用，内置hash更新规则、CAS历史与导入逐项选择不取代作者批准。

导出严格投影模板字段，不读取模型/设置/Key；导入未知凭据字段被严格schema拒绝。模板文本本身按作者原文导出，未声称扫描文本内容中的用户自行写入秘密。管理窗口复用原PromptsClient，原向导启用过滤、停用裁剪、读取失败门控和拼贴不自动发送由实际React回归覆盖；本地API标识在worker内处理，不开启远程服务或触发模型请求。

浏览器API为受控本地响应，PGlite持久化与事务为另一层真实证据；没有把两层合称真实Electron联合验收。未使用真实Key、付费服务或用户作品库，未改变正式531用例状态。
