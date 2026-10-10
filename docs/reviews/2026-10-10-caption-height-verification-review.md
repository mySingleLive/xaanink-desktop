# 三栏顶部高度恢复：独立最终证据审核

结论：本轮限定验收通过，无新增阻断；完整 core/browser 未通过，整体验收未通过。Windows 三栏顶部恢复 44 DIP，增加的 12 DIP 位于既有 32 DIP 控件区下方；本轮证据支持按钮位置和尺寸保持不变。此结论不提升 W03/W04 或业务正式 planned 状态。

本审核仅只读核对主验证报告、原始 TAP/JSON、来源及包 hash、构建/运行记录和原生截图，唯一编辑本审核文件。未重复测试、构建或原生操作，也未重新审核前轮关闭 X 的全部矩阵。

源范围已核对：当前 CSS 相对 `desktop-before.css` 仅说明注释、Windows 行高 32→44 和新增 `12/zoom` 下内边距；既有 1 DIP 边线补偿、按钮/SVG 尺寸、菜单、安全区、Tab/scroller、原生代码和 Web/mac 作用域保留。前阶段方案、测试、代码审核均通过。原始 `tdd-red.tap` 是实际约 32 DIP 标题不符合 44 DIP 期望的几何失败（5 项、4 pass、1 fail）；首次浏览器启动失败另列，不算行为 RED。`targeted-green.tap` 为 5/5，完整五 zoom × 三字号 × 空/单/八 Tab 矩阵执行，并检查固定 top/width/height/centre、44 DIP 标题/正文起点、32 DIP Tab 和实际纵向溢出。

独立从本轮原始 core/browser TAP 匹配 verification.json 的 52 个关联名称：52 个唯一名称各恰有一个实际 pass，无缺失、重复或失败；未拼接上一轮通过结果。它们仍包含受控组件/模块测试，不能直接计作原生或完整业务验收。

| 本轮完整运行 | 文件 | tests | pass | fail | cancelled | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| core | 246 | 1741 | 1605 | 123 | 11 | 2 | 1 |
| browser | 29 | 206 | 174 | 32 | 0 | 0 | 1 |

已逐字段核对原始 footer 与对应 JSON，完全一致；时长分别为 921793.8758 和 405558.0731 ms。browser 明确使用本机 Chrome。失败、超时及取消均保留；不将数量变化解释为已确认基线或与改动无关。

原始 core TAP 确有全部 22 个 LH23 结果，LH23-20 为 120000.9009 ms 的实际 testTimeoutFailure，LH23-22 为 HANDOFF_IO_FAILED。`core-run.json` 的本轮 runner/test runner 为 270648/269712；`core-file-timeout.json` 记录其专属 worker 258536、精确创建时间、age 367.1396618 秒、无子进程及执行前核验后停止。主代理报告清理 session 77157 exit 0、完整 core session 98403 exit 1。清理不计 pass，取得的完整失败 footer 保留；本审核没有操作进程。

已独立重算来源：两套完整运行快照各 977 个 TS/TSX/JSON/CSS 与 lock 来源，hash 全部一致；相对上一轮最新完整 core 快照，仅 `src/app/desktop.css` 与 `tests/browser/caption-alignment.test.ts` 两源变化。当前全快照中恰有 10 个换行恢复文件 raw hash 不同，其余 967 个相同；这 10 个归一 LF 后均精确匹配两套运行快照。另逐一核对 10 份 originals 备份、prepare 元数据与当前文件，原始字节 hash 完全相同。11 个产品/关联测试源当前 raw hash 与本轮两套快照一致。没有把换行等价称为 raw 全树一致。

已读取 finalize.mjs，其逐项检查 footer、唯一关联结果、来源、恢复记录、原生样本和包；主代理记录两次实际 exit 0。本审核另行只读核对上述关键数据，没有运行会改写 verification.json 的 finalizer。`checks.json` 是实际工具会话的汇总，静态 exit 字段本身不作为执行成功的单独证明。主代理实际 UI/typecheck/desktop/package 会话均报告 exit 0；所读 package.log 确含 after-pack 314 资源、PGlite 已关闭及最终 packaged 阶段。

安装器已独立读取：276571803 bytes，SHA256 `c01a495d7f98e14a8211b79a143b71289b43cbb99cbb65307ae57d7731344d29`。dist 与包内 main 均为 `8935653ae32a3760dc616cbe127b16cd913a443d5c5c485804086fc71d5bd400`；CSS 源为 `2abb25ebe1b07dc521b351ad951ea51431c2906a74fb1d27eb98a26053a51a43`，与本轮原生 ready/样本一致。关闭装饰源 SHA 与前轮相同。执行对象为新 unpacked exe；NSIS 安装/升级未执行。

已独立查看三个原始 `height-normal/max/restored.jpg`，并读取 driver、日志、三份 native JSON 和 compare-native.mjs。实际 Windows Electron 44.6.0、OS scale 1.5、zoom 1、字号 14、paper、同一隔离夹具下，三栏标题均由 32→44 DIP，原生 overlay 仍 32 DIP。将 normal/restored 对旧 geometry-final、max 对旧 geometry-max 的 15 项可见控件逐项重算：labels 相同，全部 x/y/width/height 最大差实际为 0；中心仍为 16 或原有 16.1667 DIP。当前空对话头部没有可见按钮，未将不存在的按钮计入这 15 项；其它真实头部状态由 browser 矩阵覆盖。

原生最大化、还原及 X 点击由主代理 Sky 执行；其实际工具结果报告 driver session 3675 exit 0、应用 exit 0，随后包窗口库存为空，native-session.log 同样记录正常 closed。driver finally 含 fallback close，因此关闭点击结论结合实际 Sky 操作/工具结果，不能仅由 closed 行推定。renderer CDP offline 只证明该 renderer 离线边界；未宣称系统全网断开。

两份台账 JSON 已解析核对，新 height 记录限定本轮结果，`fullAcceptancePassed=false`；W03/W04 及全部 29 个 contentTabs 正式状态均为 planned。物理其它 DPI、多屏/mac、不同原生字体/zoom、完整拖动/Snap、关闭保存错误/取消及安装/升级矩阵未新增执行，前轮证据不冒充本轮复验。主报告对这些范围和全量失败的限定与原始依据一致。
