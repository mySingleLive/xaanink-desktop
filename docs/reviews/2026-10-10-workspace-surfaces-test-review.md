# 工作区测试独立审核

2026-10-10。独立子代理先确认技术方案修订通过，再只读审核测试清单和 `tests/browser/workspace-surfaces.test.ts`。结论：允许先运行旧源码 RED，无阻止浏览器用例运行的必修项。

固定批准色值独立于实现；线宽以普通业务边框作比较；split直接提取产品JSX；Shell/Group实际拖动、键盘、显隐和窄布局保留原逻辑。文件首注准确声明业务/Monaco CSS探针及CSS zoom边界。实际覆盖15个DPR×zoom组合、轮换字号，不能声称是完整45组三维矩阵。抽取Chat头部外多了一层display:contents标记，实施若依赖chatpane直子选择器须同步夹具；当前通用caption规则不依赖它。

真实Windows验证架构（新隔离temp、真实Workspaces/prisma/DraftJournal、重启实际组件、正常settings IPC/原生zoom）通过范围审核，但脚本终验前还须补：实际按钮中心/尺寸/安全区；正文选区需通过选中文字行为验证而非只读取Monaco代理textarea；合成composition须与物理系统输入法明确区分；主题切换后消息、AI表面与稿件内容须单独断言。这些项不阻止浏览器RED，关闭情况留到代码与最终证据审核。

依据：[测试清单](2026-10-10-workspace-surfaces-test-cases.md)、浏览器专项文件、真实Windows采集脚本。审核结论仅为测试设计，不是执行通过。
