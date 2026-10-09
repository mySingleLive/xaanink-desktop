# Windows 窗控主题测试清单独立审核

日期：2026-10-09。结论：**通过，可按清单先添加失败回归，再进入实现。未发现阻断问题。** 本次只审核测试设计，未执行用例或验证产品。

## 审核范围与依据

已完整读取 `docs/reviews/2026-10-09-window-controls-theme-test-cases.md`，并结合上一阶段已检查的实际源文件。命令：`Get-Content -LiteralPath 'docs/reviews/2026-10-09-window-controls-theme-test-cases.md'`。仅新增此审核记录，不修改测试或实现。

## 核查结果

- TDD 顺序明确：独立技术方案审核在前，新增回归并保存旧代码失败，再实现、重复测试、独立 code review、全量活动用例和真实 Windows 验证。计数、失败、构建与截图证据均要求落盘，不能将未执行结果记为通过。
- WTHEME-01–03 覆盖真实 CSS background/foreground 令牌、透明 overlay、44px、高低系统模式、显式选择及 null/销毁/非 Windows 窗口。helper 调用测试直接使用实际实现，不只验证预期常量。
- WTHEME-04–05 对 main 的真实 `refreshMenus` 与 `nativeTheme updated` 回调提取执行，覆盖即时提交、旧 revision、同 revision 新窗口、无窗口缓存、system 保留选择值；避免加载整个 main 而触碰启动 I/O。实际 send 路由 `index.ts:105–107`、设置成功提交 `:479–509` 与配置导入 `:386–388` 已有统一 state 广播，是可核实的接入路径。
- WTHEME-06 明确把三个 constructor 的共享配置检查标为静态接入审查；主窗 constructor read 和维修/重定位快照的区别保持准确，不以模拟窗口代替辅助窗口原生验收。
- WTHEME-07–10 包含纸纹连贯、设置内即时切换、设置关闭后、右栏显隐、Tab 状态、符号可读、hover、关闭红色反馈、非活动窗口、最大化/复原/最小化/正常关闭与跨进程重启。明确使用包含原生按钮的 Computer Use 截图，且不以 capturePage 替代 native 结果。
- 数据和证据范围适当：新隔离根、无作者数据/Key/模型/HTTP、离线解包应用、实际 OS 与 Electron 受控 system 事件区分、只声明本次主题窗控范围，W03 保持 planned。这符合本次修复边界。

## 实施时需保留的核对点

1. AST harness 必须依据实际 AST 的函数和回调构建，不手工重写逻辑；除执行 `refreshMenus`，还要执行或结构核对实际 `send` 的 state 分支，验证提交/导入确实调用已审核入口。旧代码失败需记录能说明问题的断言，不能仅用 helper 文件不存在充当全部红灯证据。
2. 同 revision 重开用一个新窗口 mock，并核对 setter 作用在新窗口，旧 revision 拒绝后再发 system 事件仍使用最近已提交选择；非 Windows 用例同时包含 macOS，且不能声称 macOS 原生通过。
3. 原生结果保留普通、hover、非活动截图或明确实际观察记录；系统事件来源、真实布局状态及是否来自新打包应用应在证据中说明。辅助窗口只完成静态或单元覆盖时应如实标明。

上述事项是执行清单时对测试真实性的核对点，不要求改变已通过的修复方案。后续独立 code review 仍需审核实际测试与实现接入。
