# 97 应用备份只读列表独立代码审核

审核者：`/root/product_review`。日期：2026-10-08。结论：本轮限定范围 PASS，无未关闭发现；独立 4 项主进程/IPC 行为和 5 项实际 React 行为通过，全量 TypeScript exit 0。完整创建备份的原生流程失败属于另一个待修批次，不能从本轮列表通过推导其成功。

## 范围与独立性

只审核第 30 批新增 ApplicationBackupsPanel、原 RecoveryDialog 的组件入口、无参数公开 IPC/preload、实际 main 中 `desktop:application-backups` handler/schema import，以及原限制抽为纯共享模块的浏览器边界。完整 main、RecoveryDialog 的 SHA 记录时点，不把其中历史业务纳入本轮。17 存储、26 Session、27 worker 列表为只读依赖，不重授核心审核。

29 应用备份库存迁移由本 reviewer 编写，本轮完全不自审为 PASS。没有修改生产文件或作者断言，没有启动 PGlite、执行 native smoke 或重建应用。

## 独立行为检查

`tests/unit/application-backups-97-review.test.ts` 4 项执行当前文件 AST 取出的原 `trusted`、`businessHandle` 与 IPC callback、原 preload bridge 表达式，使用真实 BusinessGate 和公开 schema。worker Promise 是受控依赖，不冒称 Electron IPC 或实际引擎关闭。

- 当前窗口被替换/销毁、主 frame 被替换、URL 改成外国来源：worker await 后全部拒绝，不发布摘要。
- gate 关闭后立即拒绝新读请求；已受理请求的原 Promise 未结束前 drain 不 ACK，失败也正确释放并允许明确重新开放。
- 参数为 null、对象、路径、二进制或其他值，以及不受信初始 frame，均不能抵达 storage。非 list 回执、额外私有字段、异常容量和日期被公开 schema 拒绝。
- 实际 preload 方法丢弃调用者所有参数，只发送固定无参数通道。当前受理读取获授权完成后不会把业务关门误当作任意可写操作。

`tests/browser/application-backups-97-review.test.ts` 5 项在实际 React/StrictMode、原 BaseUI Button 与 CSS、隔离 Chromium 中执行组件；拦截并拒绝所有外部网络。

- effect 清理和新连接使用不同 flight：旧失败/成功不能改新列表、错误或 busy，也不能越过卸载修改重开实例。
- 实际 1000 项合法摘要通过 49 次真实分页点击遍历全部 50 页，每项只到达一次；排序、日期、大小真实，原输入数组不被改写，不渲染 appId。
- 刷新失败保留旧页与内容；新的较短成功列表回到第一页，不留下越界空页。
- bridge 缺失与坏回执明确报错、不伪装为空、不显示私有路径/坏行；明确重试的合法空回执才显示空状态。

限制常量抽取为纯共享模块，公开 schema 不再带入 Node FS；原限制值不变。父代理成功的 UI/desktop 构建为只读佐证，reviewer 没有执行构建。

## 实际证据和过程记录

`review97-01-independent-main.tap` 实际 4/4、exit 0；`review97-03-independent-browser.tap` 实际 5/5、0 fail/skip/cancel、exit 0，未出现 pageerror。`review97-04-independent-typecheck.txt` 全量类型检查实际 exit 0、空诊断。计数是本轮独立 9 项，不将作者 7 Node/9 React 及其他共享回归重复累计为 531 用例覆盖。

`review97-02-independent-browser.tap` 的五项 hook 失败来自 sandbox 中 Chromium MachPort 1100 启动错误，测试正文没有执行，不算产品 RED。以相同源码和行为断言在已获准的隔离浏览器环境重试后产生 03 全绿日志；没有弱化 oracle。

父代理第 30 批完整 native batch 已失败：实际 UI 显示应用备份失败、作品备份保存成功，smoke 只是等待成功直到超时。其 failure JSON/PNG/log 原样保留且明确排除于本次冻结。本轮不报告原生创建备份成功，也不将错误隐藏问题归为已验证修复。在线 capture 协调、应用恢复激活、迁移、物理系统选择器、Windows 和正式 531 验收不在此结论内。

## 冻结核验

`application-backups-list-frozen.json` 与 `-v1.json` 同字节。12 作者文件、2 独立测试、8 只读依赖、14 证据共 36 份 SHA 全匹配。按上述四组按序 path:sha256、LF 且含末 LF，聚合 `ed2596ff027d767fa012495f955069fcef29fa00bc4661f78535de24522b1080` 匹配；独立核验记录 `review97-05-final-manifest.json`。结论仅对应冻结的只读列表接线。
