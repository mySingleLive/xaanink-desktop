# 空右侧收起图标尺寸统一独立 code review

2026-10-09（Asia/Shanghai）。只读审核当前产品组件、扩展浏览器fixture/几何断言、原生harness及本轮RED/GREEN日志，参考157–160。未启动应用、执行测试或修改其它文件，上轮未提交工作保持。

结论：**通过，未发现本轮实现或用例的阻塞错误。** 当前已验证日志仅为聚焦RED/GREEN；完整活动套件、构建及新implementation-48原生终态仍由主代理执行，不能沿用47结果声称本轮已全部通过。

## 修改范围

- `ContentTabs.tsx` 的空态PanelRight现为size-4；有Tab导轨仍为size-3.5，默认点击区仍size-6，名称/提示/焦点样式/Windows padding/回调未改。为区分上轮尚未提交的产品diff，本代理只读将当前唯一空态size-4还原为size-3.5后计算SHA-256，结果与implementation-47已通过原生报告记录的ContentTabs源码哈希完全一致；因此相对上轮实际产品变化确实只有该处class。
- 真实左导航`SidebarWindowControls`的PanelLeft已经size-4。同为Lucide图标并使用同一root rem，当前零TabPanelRight默认16×16，与左导航一致；内部图形变化没有扩大或移动右按钮命中区。没有新增IPC、平台状态、设计样例或修改原生窗控。

## 浏览器用例

- fixture实际引入SidebarWindowControls并放在restore/content/menu之后，用绝对定位把它放在左上；右内容面板仍贴视口右缘，新增左控件没有推动右区，也没有破坏restore后一次Tab到右按钮的DOM顺序。左侧无关收起回调在fixture中为空，但两处实际SVG都来自真实产品组件，未用手写图标替代基准。
- geometry从明确右隐藏button与左侧“展开或收起左侧导航栏”button的子SVG读取实际getBoundingClientRect。contained逐次检查左右宽高相等、等于root rem、原右button宽高为1.5rem及SVG包含在button内；原面板内位置、顶部、no-drag/drag合同仍检查。当前geometry新增button.height，避免只检验一维点击区。
- darwin/Web/default、Windows45组fallback及48组env读取注入矩阵沿用相同contained，实时字号/zoom下图标比较和点击区断言同步执行。env注入仍从真实菜单CSS和真实inline style仅替换env读取，未退回手写菜单表达式；该证据仍为浏览器合同。
- EMPTY-02继续实际Tab到达、activeElement/outline检查及Enter/Space；EMPTY-05继续有Tab控件、逐个关闭和空态收起/恢复。新增左控件没有用脚本focus或直接callback绕过右侧键盘回归。

## 原生 harness 及证据隔离

- inspect在现有真实几何稳定等待后，从完整工作台的左右收起button读取SVG，记录尺寸和rootFont，再断言左右相等、各为1rem、右button为1.5rem及SVG包含。实际settings IPC/native getZoomFactor、系统鼠标gate、窗口状态、重启AI恢复、最后Tab流程保留，未改为mock。
- evidenceRoot增加argv[2]选择，默认47保持原有CLI兼容；本轮主代理应明确传入implementation-48。各运行仍使用mkdtemp basename独立repo证据目录，失败不覆盖成功alias，成功后只清理临时运行根。最新SVG字段必须由本轮48真实运行生成，不能使用旧47图/JSON证明当前尺寸。
- 默认24px点击区随UI字号使用1.5rem是原产品合同，计划中的“不改24px点击区”指默认字号，而非把所有字号硬固定24px；当前代码与断言对此一致。

## 已读取日志

`/private/tmp/xaanink-icon-size-red.log`完整终态0通过/8失败，失败为“The empty content hide icon must match the real sidebar hide icon”，实际右14×14对比左16×16；不是组件缺失或环境错误。`/private/tmp/xaanink-icon-size-green.log`完整终态22/22通过，0失败/取消/跳过。主代理报告相应命令exit1/exit0，本代理只读取而未另跑。

完整套件/native最终审核仍需核对本轮源码指纹和新报告；Windows原生/DPI、当前安装包未执行时保持未执行边界，不提升W05及业务迁移总状态。
