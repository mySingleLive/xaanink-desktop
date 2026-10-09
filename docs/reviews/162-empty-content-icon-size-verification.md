# 空右侧收起图标尺寸统一验证

2026-10-09（Asia/Shanghai）。用户要求右侧新按钮图标与左侧导航栏图标同尺寸。157–161独立方案、用例及code review均通过。

产品只将真实 `ContentTabs.tsx` 零Tab按钮的PanelRight从size-3.5改为size-4：默认16×16px，与真实 `SidebarWindowControls` 的PanelLeft一致。默认右按钮点击区仍24×24px，顶部位置、Windows窗控/菜单留距、drag/no-drag及原收起回调保持。相对implementation-47的ContentTabs指纹，只读还原这一个class后完全匹配；其它既有导轨图标不改。

| 本轮实际执行 | 结果 |
| --- | --- |
| 修改前几何RED | 8例均因实际右14×14、左16×16不等失败；exit 1 |
| 修改后聚焦回归 | 22/22 pass；exit 0 |
| 完整活动unit/integration | 1624例运行：1623 pass、0 fail、1 timeout cancelled；exit 1 |
| 受影响brand-data-compatibility完整文件重跑 | 14/14 pass、0 fail/cancelled/skipped；exit 0 |
| 完整活动browser | 193/193 pass、0 fail/cancelled/skipped；exit 0 |
| 完整typecheck | exit 0 |
| UI及desktop构建 | 最终各exit 0 |
| 完整真实macOS Electron | 22条检查全部通过，errors=[]；exit 0 |

唯一自动用例共1817项（core1624 + browser193），当前源码上每项均已有通过结果。core首次执行不是单次全绿：BDC06 legacy数据库迁移在并行验证期间达到60秒超时，被Node计为cancelled；其它1623项通过。其它重型验证结束后，未修改任何源码/测试/超时阈值，完整重跑该14项文件全部通过；原超时用例耗时25550.934208ms。重跑文件14个名称与完整日志中对应14项一致，以重跑结果替换该文件结果后core唯一1624项已验证。不能把首次exit 1写成exit 0；聚焦22及重跑14不重复计入1817。超时日志与重跑日志均保留，不宣称已经证明超时的具体根因。

Node 24.18.0。完整命令为 `node --import tsx --test --test-concurrency=2 --test-reporter=tap tests/unit/*.test.ts tests/integration/*.test.ts`，browser同参数运行 `tests/browser/*.test.ts`；重跑使用concurrency=1及完整 `tests/integration/brand-data-compatibility.test.ts`。Chromium使用现存headless-shell-1228。退役备份测试未执行。初次受限UI构建在编译阶段无进度，终止该本轮进程，exit143；保留日志后在允许构建进程工作的环境重跑成功，未据此虚构已确认的卡住根因。最终构建完成后才运行依赖生成物的browser。

浏览器夹具实际引入左导航 `SidebarWindowControls`，按原DOM键盘顺序保留restore→右按钮。所有原有空态几何检查读取两处真实button的子SVG，左右宽高相等且接近当前root rem（允许实际像素舍入0.05px）；右按钮宽高仍1.5rem，SVG完整位于点击区内。Windows fallback45组、env读取注入48组、字号11/14/24及实时zoom矩阵全过，保持面板顶部内定位、菜单至少6px间隔及窗控预留区。Windows证据是浏览器布局合同，不是Windows原生/DPI验收。

真实macOS运行当前out/dist、完整原组件、本地xaanink://app/协议、CDP offline及全新canonical /private/tmp隔离dataRoot。按独立临时Electron.app路径选择本轮窗口。实际CUA原生截图可见左右图标，默认测得二者16×16、右按钮24×24、右距8px；系统鼠标点击后右区卸载，AI恢复入口出现，原生窗口bounds/zoom/最大化/全屏不变。真实zoom .75/1/1.25/1.5/2×字号11/24十组中，左右SVG逐次完全相等，并跟随root rem及原按钮1.5rem。Enter/Space、Shift+Tab/Tab与焦点outline、重开后沿用既有零Tab恢复规则并通过AI入口重新展开、最后Tab自动收起及空区恢复后再次收起均通过。键盘由Electron/CDP注入，未声称硬件键盘/IME验收。

本轮证据独立保存于implementation-48，包含日志、原生JSON、CUA原生截图、renderer截图及1247个源码/测试/构建SHA-256；报告中的7个源文件指纹与当前源码一致。immutable报告位于 `implementation-48/xaanink-empty-hide-hxEpuk/empty-content-hide-native.json`，成功alias与其一致。旧implementation-47报告及指纹记录保持，未拿旧证据证明新尺寸。成功后仅清理本轮隔离根，没有使用用户数据或Key。

台账只新增W05的有限development记录、SIZE-01–04及迁移台账同名记录，原W05总status和业务迁移状态保持。未重新打包、安装或发布；Windows原生目标机/DPI、多屏/窄屏全工作台及系统完全断网未执行。上述范围不升级为完整跨平台或安装版验收。
