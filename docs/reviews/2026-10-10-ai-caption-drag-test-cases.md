# AI 标题拖动回归用例

按方案及独立审核实施。真实 React ContentTabs / useContentTabStrip / CSS 挂载，业务面板沿既有夹具隔离；不把浏览器几何当作原生通过。

- AIDRAG-01：20 个标签，激活首/中/末，面板宽度 520→450→650；扫描所有 computed no-drag 元素，任何与标题 y 范围相交的矩形均不得越出右栏；明确检查已被裁剪标签/关闭按钮不再登记 no-drag，viewport 则 no-drag。覆盖 scrollLeft 改变和分割线向右移的几何。
- AIDRAG-02：仅一个短标签。viewport 宽度紧包标签，后面至少有 80px 空白；空白 DOM 命中归属 desktop-drag，窗口按钮位置与既有布局一致；标签点击、Enter、关闭入口保留。
- AIDRAG-03：单长标签从 220px 窄栏拓宽至 700px 后宽度恢复 208 DIP 上限，避免 intrinsic/cap 反馈锁住宽度；覆盖 .75/1/1.25/1.5/2 缩放及字体。
- AIDRAG-04：所有既有 ContentTabs 选择、横向 wheel、键盘焦点、排序/取消、自动滚动、关闭/中键、菜单及面板实例/草稿测试继续执行；更新旧 app-region 断言为“viewport 排除、后代 initial”契约，不能删掉交互断言。
- AIDRAG-WIN：实际 Windows Electron44.6、合成会话有标题/6个真实面板、零模型、隔离数据根、离线启动。修复前末标签标题右侧拖动 bounds 不变，首标签同点正向对照；修复后末标签 AI 左/中/右系统鼠标拖动均移动且尺寸不变。系统鼠标分割线右移后重复右侧/中部；可见 tab 拖动只排序不移窗，关闭/面板按钮正常点击且不移窗；单标签后标题空白可拖窗。记录 OS 鼠标操作坐标、前后 bounds 和截图，构建后执行，不以注入 CSS 替代。

RED/GREEN 记录存 docs/evidence/ai-caption-drag。全量 core/browser、类型/构建实际执行，历史失败保留。本用例不覆盖 macOS、安装包、多屏/DPI 全矩阵或全部业务验收。

## 第二阶段（人工仍失败后追加）

- AIDRAG-05：从源 AST 提取真实 ThinkingRow 函数、ChatPanel 标题和实际消息 wrapper / scrollRef JSX，隔离无关 AI/恢复业务。20 条合成消息，滚动第 10 条 ThinkingRow 到其布局 rect 位于标题 y=8（仍被正文 viewport 裁剪）；明确证明该按钮 rect 与图标/首字 x 区间相交、scrollTop>0。任何注册 no-drag 矩形都不得侵入标题，所有消息后代 computed none、bounded host computed no-drag。宽度 600→320→720 与五档 zoom 重复；这是浏览器布局回归，不声称全 ChatPanel 业务已验收。
- AIDRAG-06：真实 ThinkingRow 可展开/关闭；非caption body/输入区 bounded 排除，内部控件解除个体注册仍由祖先排除；真正 caption/sidebar/content 恢复按钮保持 no-drag 且可点击。用例不靠删除交互断言变绿。
- AIDRAG-WIN2：第二阶段最终开发构建，用户人工重新启动，在此前失败图标/首字与其余标题点拖窗、右移分割线后再试，并滚动对话历史重复。人工确认与系统双击分开记录；当前第一次人工失败保留，不用浏览器全过代替。
- AIDRAG-07：真实 MentionPopup 在隔离定位前置中跨越caption，根 no-drag、全部后代none；内部20项纵向滚动后，隐藏button跨越标题但不单独注册；真实选项 onMouseDown 选择、卸载和caption恢复。fixed tooltip用明确隔离probe验证根排除/按钮回调，不当作实体hover业务验收。不对常驻隐藏absolute tooltip恢复区域。
