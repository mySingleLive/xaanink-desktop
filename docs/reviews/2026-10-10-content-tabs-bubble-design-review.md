# 右侧内容 Tabs：圆角气泡修订独立审核

日期：2026-10-10（Asia/Shanghai）。仅新增本审核文件；未改产品、旧审核文件或测试，未执行产品专项或全量测试。

结论：**圆角气泡设计阶段审核通过，无新增阻断；可以提交用户审核，修订 HTML 的用户批准仍待取得。** 用户最新要求将标签改为圆角气泡、上下等距留白并移除深红色边缘，本轮以该要求覆盖先前底缘无缝连接设计；用户提出改法不等于批准最终 HTML。本次仍按调研/产品修订 → HTML 用户审核 → 实现 → 相关专项测试推进。

## 必须落实的设计边界

- 标题栏仍为 44 DIP、标签为 32 DIP，顶部和底部各 6 DIP。完整圆角采用约 16 DIP 半径，下缘不再覆盖标题栏分割线。旧设计的 12 DIP 上留白、底缘相连及选中顶部强调线须从活动产品规格、HTML 和预览断言中撤换；历史审核保留原时点结论。
- 深红色 selected inset 阴影/边线移除，键盘焦点保留可见的中性主题令牌，不能因去掉红边而删去焦点反馈。正式实现继续使用真实主题下的 `--editor-bg`，不复制 HTML 硬编码主题值。
- 标签条保持单行无可见滚动条、最大 208 DIP、只对实际溢出标题施加 mask，不追加省略号；图标、后缀及关闭按钮保留。溢出菜单、键盘手动激活、关闭当前项前项优先规则继续沿用前轮方案。
- `src/app/desktop.css:13–24` 的现有 Windows 工具/原生控件仍围绕 y=16 DIP；Tab 居中到 y=22 DIP 不构成移动这些工具的授权。正式实现须在实际 `src/components/layout/ContentTabs.tsx` 做局部头部样式改动，并保留 `ContentTabs.tsx:204–216` 的业务面板 map/key/hidden 实例结构；`docs/implementation-boundaries.md` 的真实组件复用和数据边界继续生效。
- 430px 窄面板是设计预览范围，不外推工具安全区不足或零宽动画已通过；批准后再依真实 Shell 的最小宽度和恢复入口定义专项验证。

## 实际修订及证据核对

只读检查最新版 `design/content-tabs/index.html`、`capture-preview.mjs`、`preview-observations.json`、README、调研/产品设计、两份台账，并独立查看最新 `preview-panel/paper/ink/narrow/menu/last-tab/small-viewer.png` 七张截图。主代理执行隔离 Chrome 预览，结果为 5 个几何场景、6 项交互、0 pageError；本审核没有重复执行预览或产品测试。

| 检查 | 实际依据 | 审核结论 |
| --- | --- | --- |
| 圆角与等距留白 | `index.html:35–46` 标题栏 `align-items:center`，标签 32px 高、完整 999px 四角；JSON 五场景均为 44px 栏高、top=6、bottomGap=6、height=32 | 标签相对标题栏上下边界等距，截图呈完整气泡；不再覆盖底线 |
| 移除红边 | selected `box-shadow:none`、描边使用 `--border`；JSON 全部 shadow 为 none，paper 描边 `rgb(216,203,166)`、ink 为 `rgba(255,248,240,.09)` | 深红顶部线已消失；纸/墨截图均保留浅主题细边 |
| 键盘焦点 | `index.html:19–20` 保留 2px outline，面板内用正文前景色 45% 的中性混色 | 去红边没有删除焦点反馈；颜色检查依据 CSS，未宣称截图覆盖了所有焦点状态 |
| 选中背景 | JSON paper 的标签及主体均为 `rgb(248,243,228)`，ink 两者均为 `rgb(16,13,12)` | 相同主体背景要求保留；正式实现仍需读取真实作用域令牌 |
| 无条与最大宽度 | `overflow:hidden`；五场景 scrollHeight/clientHeight 均为 32；正常最大 208，430px 窄面板最大 162=视口宽 | 标签条无可见滚动条，宽度上限及局部视口限制保留；预览移除了浏览器默认隐藏滚动条参数 |
| 渐隐范围 | `.tab-title` 单独 mask，按实际 scrollWidth/clientWidth 判断；短标题 `mask=none` | 标题渐隐保留，图标、后缀及关闭按钮保持清晰；未加入省略号 |
| 工具与安全区 | 工具布局 `index.html:56–65` 未因气泡居中而下移；五场景记录工具中心 y=16 | 保留原生/工具几何目标；窗控截图仍只是占位 |
| 溢出交互 | 菜单 clamp、独立切换/关闭项、完整标签显露、唯一 Tab 入口焦点及关闭当前前项优先保留 | 六项预览交互与源码一致，未将原生/业务交互计为通过 |

最新版预览 JSON 明确 `revision=bubble-v2`，Chrome 为 154.0.8037.98、Node 为 v24.19.0；`capture-preview.mjs:35–39` 的断言已经撤换旧 top=12/seam=0，改为 top/bottom=6、四角半径至少 16、shadow none 和非红描边。当前预览不是对旧几何结果重新贴名。

## 文档和状态边界

`2026-10-10-content-tabs-product-design.md` 已在开头声明新要求覆盖相连标签；视觉规格、技术落点、HTML 审核重点和 TABS-02 均改为气泡/6 DIP 等距/无红边/连续底线。调研结论、README 和 `requirements-traceability.json`/`migration-map.json` 的本次记录同样使用 bubble-v2。调研表格保留旧源码现状，首版 HTML、图片与预览记录归档至 `design/content-tabs/archive-v1/`，旧独立审核保持历史原文，未冒充新审核。

两份台账都保持 `awaiting-user-ui-review`；产品实现及产品测试未执行，`fullAcceptancePassed=false`。430px 窄稿与560px 查看器截图只能支持该设计范围；真实组件的 zoom/字体/封面与暂定 badge 组合、极窄紧凑入口、零宽动画恢复及目标 Windows 原生检查留在批准后专项阶段。没有提高 29 类业务面板状态，没有运行全量或全量回归，也没有把主题切换当作 macOS 验收。
