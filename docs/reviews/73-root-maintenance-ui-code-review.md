# 73 · 维护进度界面独立代码审核

日期：2026-10-08。审核者：product_revision_review。UI作者为 product_review。审核者未修改组件、作者测试或shared，只新增独立浏览器测试与证据。审核者编写的维护runner不在本轮独立通过范围，另由第72轮审核。

## 范围与结论

结论：限定范围 **PASS**。唯一实际发现MUI73-06已修复，独立实际React/Chromium合跑24/24通过，全量TypeScript检查exit0。范围为 `RootMaintenanceScreen`、`src/types/desktop.d.ts` 的可选维护桥声明、shared RootMaintenanceState/Bridge和两份UI合同。main、preload、runner、根迁移/重启及正常工作台没有被本轮扩审或修改。

作者v2冻结清单的5份作者文件、1份只读独立测试、5份依赖和21份证据均逐项SHA匹配；按ordered files then independentTests的path:sha256记录、LF连接且含末LF重算aggregate，准确为 `21791d7c23c2f2e123a10fb5f7feb28ffe87f27e5666de25c74645ea8261755c`。v1原样保留。独立最终清单为 `docs/evidence/implementation-12/review73-final-manifest.json`，对应生成器同时校验最终TAP计数与空诊断日志，不把作者自报结果当作独立执行。

## 实际发现

|编号|严重程度|独立复现|修复状态|
|---|---|---|---|
|MUI73-06|P2|合法快照显示已复制1/4后，更高revision但copiedFiles=7/totalFiles=4的非法事件被isState接受并替换最后合法快照。文本变成7/4，原生progress按max4钳为满条，丢失最后准确进度。|作者新增一行known-total上界检查：totalFiles非null时copiedFiles必须≤totalFiles。unknown/null仍可表示未知总数，0/0仍合法。修复后独立06通过。|

这是故障注入下的UI校验/真实性问题，不意味着正常runner会产生超过total的计数。组件已声明拒绝malformed事件并保留上一个合法快照，因此不能接受此矛盾计数后由浏览器自行钳满。修复没有改动phase、权限或核心迁移行为，审核者没有改作者测试以迎合结果。

原始 `review73-01-independent-behavior.tap` 为10项9PASS/1FAIL，唯一失败为06，实际React/Chromium运行、无编译/环境/夹具错误。`review73-component-diff.json`记录确切一行差异；旧源文本通过移除该修复行反向重建，SHA准确匹配作者v1的43f3dce…，明确不伪称预先捕获的源快照。初始freeze-check在作者修复已进行时核验，26条里仅当前组件与v1旧hash不同，其余25条匹配；这是已知修复差异，不计第二个缺陷。

## 独立行为与界面核对

10项新增测试使用实际React组件、原Button、已安装BaseUI及当前globals/desktop CSS，esbuild编译浏览器bundle、PostCSS/Tailwind生成真实CSS，唯一控制项是维护preload。所有页面请求拦截，不使用工作台bridge、真实根目录或模型。

- 01在state读取内部同步发送更新，验证subscribe先于state；迟到初读及旧/相同revision不能恢复取消权限。
- 02使用StrictMode两条独立的初读Promise，而非共享一个Promise；旧effect的更高revision和失败初读也不能覆盖新连接。实际cleanup取消订阅。
- 03在React尚未提交新DOM前，main事件已收回权限，再激活旧的enabled cancel/continue按钮；同步current.state守卫拒绝命令。
- 04在command调用内同步送入complete事件：新continue按钮仍因旧cancel pending而禁用。命令迟到失败只显示固定本地提示，不把权威complete退回旧状态。
- 05真正卸载/重挂后，旧事件、旧读取和旧命令失败保持隔离，不影响新主题和状态。
- 06验证非法超过总数的事件拒绝，并由后续合法更高revision清除错误、恢复真实进度。
- 07在原BaseUI Button上执行headless页面的Enter/Space键盘激活，实际disabled语义和同步pending守卫只发一次cancel；成功Promise不乐观宣布取消。
- 08验证subscribe/state同步抛错时仍有受限quit，pending可见且禁用，不传播私有message，不调用正常工作台bridge。
- 09验证unsupported phase拒绝并保留原进度；未知total没有value/百分比，真实0/0通过aria-valuetext呈现，max=1只是原生零分母兼容。
- 10验证paper/ink在320×240视口、精确4096字符路径的断行和实际滚动。主区域无横向溢出，原data-slot Button可滚到可视区；两类pending分别显示旧目录清理、目标目录回滚的准确数量，没有活动进度条或工作台/demo节点。

正常工作台bridge被Proxy监控，任何访问会使测试失败，最终10项均无访问。键盘事件是实际headless浏览器页面行为，不是物理OS快捷键或Electron原生菜单验收。theme语义颜色、data-slot及CSS从原实现读取，没有在测试里另画维护界面。

源码核对：组件只有维护桥和类型import，没有fs、目录授权、模型调用或启动迁移的能力；三个命令闭包只传cancel/continue/quit字面量。文本路径由React转义显示，不作文件路径解释。状态事件以Connection.alive与精确connection identity隔离，receive同步记账后才setState；command发送前同步pending记账，旧Promisefinally不能释放新连接的pending。type声明仅新增可选维护桥，未扩大工作台桥能力。

## 验证与限制

使用本机已有1228 headless Chromium，不下载浏览器；隔离进程获得自动工具审批，未操作可见Electron。独立复跑作者14项与新增10项。旧 `review73-04-related-green.tap` 为24/24、`05-final-typecheck.txt` exit0，均保留历史。

路径夹具复核发现早期“4096”描述实际仅3279字符；审核者将自己测试改为精确4096并加入length断言，不计产品缺陷。最终验证以 `review73-06-final-4096-green.tap` 和 `07-final-typecheck.txt` 为准，而非用旧24项证明未执行的4096边界：实际24/24通过，fail/cancelled/skipped/todo均为0、测试exit0，全量TypeScript检查exit0且无诊断。

```sh
XAANINK_TEST_CHROMIUM=<user-home>/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell node --import tsx --test --test-reporter=tap tests/browser/root-maintenance-ui-review.test.ts tests/browser/root-maintenance-screen.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

截图 `review73-paper-long-path.png` 和 `review73-ink-long-path.png` 为独立浏览器组件在长路径下滚到底部的证据，已实际像素查看；计数/按钮/滚动验证来自DOM和boundingBox。它们不是完整Electron窗口、真实目录或Windows截图，不证明系统窗口拖动/控制按钮/文件选择器。

root的 `native-runtime-migration.json` 是额外作者证据：macOS arm64实际设置关闭、旧进程退出、隔离维护重启、1391/1391复制完成、精确receipt ACK后冷重启回原Web工作台，共4组。该证据明确原生picker/confirmation返回受控，并非真实OS选择器UI；不计入本审核者24项，也不替代本轮独立UI验证。

不宣称真实Electron、Windows、原生窗口/菜单/选择器、数据库关闭、磁盘耐久性或完整用户验收通过。531正式顶层用例状态未改，主进程接线和runner仍须各自独立审核及实际组合验收。
