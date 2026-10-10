# 紧凑窗控测试清单独立审核

日期：2026-10-10（Asia/Shanghai）。审核 `2026-10-10-window-controls-compact-test-cases.md`、现有 `tests/unit/window-appearance.test.ts`、`tests/browser/chat-caption-safe-area.test.ts` 和测试入口。本次仅审核清单与夹具来源，未改产品/测试，未执行测试。

结论：通过，可按清单进入 TDD。无阻断发现；下述执行要求必须体现在后续测试和验收证据中，不能将本审核报告记作测试通过。

## 对应关系与真实执行范围

| 清单项 | 已核对的现有路径 | 审核结果 |
| --- | --- | --- |
| WCO-C01 | `window-appearance.test.ts` 的 WTHEME-01/02/03 | 真实导入 helper。paper/ink 的明确 `height: 44` 期望应改为 32，system 对两种真实解析结果的比较保留。setter fixture 记录生产 helper 的调用参数，证明接入与主题解析，不是原生绘制证据。 |
| WCO-C02 | 同文件 WTHEME-04/05/06 | WTHEME-06 通过 TypeScript AST 提取、esbuild 编译执行 `index`、`root-maintenance-window`、`root-relocation-window` 三个实际 BrowserWindow options 表达式，明确高度期望改为 32。现有 revision/source/重入/缺失窗口与非 Windows setter 回归应全部保留。 |
| WCO-C03 | `chat-caption-safe-area.test.ts` 的真实 WindowsMenuControl import、生产 CSS 编译、WCO-S01/S02/S03 | 适合追加真实 boundingBox/top/height/center 断言；测试生产组件与实际 CSS，不应复制待测 CSS 规则或通过源码字符串声称实际布局通过。S01 已有五档 zoom 和两种窗口宽度，S02 保留原生 env 值替换的安全区矩阵。 |
| WCO-C04 | 清单规定的隔离 Windows Electron 44.6.0 窗口 | 与上两类 fixture 分列正确。必须保留原始窗口截图、原生几何与实际窗口状态结果，不能用 Chromium 的 platform 参数代替真实 Windows 原生验证。 |
| WCO-C05 | `package.json`、`scripts/test-core.mjs` | `npm test` 仅 unit/integration，不含 browser；`scripts/test-core.mjs` 自带 120 秒全局 timeout，超时不能作为全量通过。需要分别完整执行活动 core/browser 并记录 footer 与进程结果。 |

## TDD 与执行约束

1. 先仅修改明确 helper/三个构造期望并追加真实菜单几何断言，在旧 height 44/top 7 下取得实质 RED，再修改生产代码。原 WTHEME/WCO-S 回归不能删改或放宽；避免以读取生产常数作为唯一期望导致相同错误同时通过。
2. 浏览器菜单 CSS top 的独立预期分别为 75% ≈ 7.333 px、100% = 2 px、125/150/200% = 0 px；高度均为 28 CSS px。按主代理补充，五档均覆盖 11/14/24 字号。100% 中心为 16 CSS px。容差只用于浏览器亚像素取整，不能把顶部夹至 0 后的菜单中心仍要求等于 16 DIP。每档继续检查 caption/恢复入口间距及菜单顶部 ≥ 0。
3. 现有 browser scenario 调整 viewport、向 store 注入 zoom，并替换只读 native env 值；没有设置 Electron webContents 实际缩放。这是 CSS 计算与隔离组件证据，必须如实标注。真实 75/100/200% 安全区及主题切换仍应在 WCO-C04 的 Electron 环境执行。
4. 当前 WCO-S03 只记录恢复内容入口的 mouse/Enter/Space，现有 bundle 没有 `window.desktop.command`，菜单的可选调用会静默无操作。主代理已明确将在同一真实组件 fixture 添加有限 command 记录 stub，新 WCO-C03 对 click/Enter/Space 核对 `app.menu` 次数/参数；此补充符合要求。实际原生菜单是否弹出由 WCO-C04 验证，bridge fixture 不能替代。
5. WCO-C04 应落实已通过方案审核中的顶部命中、正常/最大化两种几何、Snap 与最小化/最大化/恢复/关闭行为。读取 readonly Window Controls Overlay 几何和实际状态可证明原生接入；截图提供 glyph 与位置证据。宽高配置单测、DOM 几何与原生操作需分别写结果。
6. 可用 Node 24 的 `node --import tsx --test --test-reporter=tap tests/unit/window-appearance.test.ts` 与同参数 `tests/browser/chat-caption-safe-area.test.ts` 分别获取聚焦 RED/GREEN；browser 需明确本机 Chromium executable/`XAANINK_TEST_CHROMIUM`。全量活动套件另行执行 `tests/unit/*.test.ts tests/integration/*.test.ts` 及 `tests/browser/*.test.ts`，并按环境选择合理并发、保留失败/取消/跳过统计。类型检查、生产构建、打包和包检查独立记录。
7. 公开 overlay API 不提供每枚 glyph 的 stroke 或尺寸调整，本清单明确未新增“统一线宽”的成功断言，符合方案。交付时只能声明真实验证过的高度、位置、菜单及系统行为，不可从本次测试推导图标已等粗或已缩小。

审核来源均为本仓库现有清单、测试/脚本源文件及先行方案审核，未将本阶段未执行的原生结果提升为 DESK-W03/W04 或双平台正式通过。
