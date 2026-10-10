# 紧凑窗控测试清单

需在方案独立审核通过后独立审核本清单，再进入 TDD。

- WCO-C01：真实 nativeWindowAppearance 的 paper/ink/system 配置 height=32，透明底和前景色保持真实主题；Windows setter 同步高度。修改原 WTHEME 期望而非复制实现测试。
- WCO-C02：现有 AST 执行的三个实际构造表达式均使用 height=32。macOS/Linux 不执行 overlay setter，主题重入/revision/source 用例继续通过。
- WCO-C03：实际 WindowControls + desktop.css 浏览器渲染，100%菜单 top=2、height=28、centerY=16；75/125/150/200% 对照 `max(0,16/zoom-14)` 实际 top。菜单不越顶且继续避开 caption，菜单及恢复内容入口保留原点击/键盘行为。原 WCO-S01/S02 矩阵复用。
- WCO-C04：Windows Electron 44.6.0 隔离实际窗口，原始截图包括 native glyph；前后 overlay 高度由 navigator/window geometry 读取，最大化恢复/最小化关闭由系统 UI 操作并读取实际状态，菜单可打开、主题切换高度不回退。截图实测与配置单测分列。
- WCO-C05：全量活动 unit/integration/browser、tsc、生产构建和 Windows 打包检查记录命令、exit code、失败/取消统计。真实离线启动验证仅声明执行条件，不替代所有业务或双平台验收。

红灯先改 WTHEME helper/构造预期和添加实际菜单矩阵，使旧 height44/top7 失败；没有新增修改原生 stroke 的通过断言，因为公开 API 不支持该变更。
