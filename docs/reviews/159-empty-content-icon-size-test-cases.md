# 空右侧收起图标尺寸统一用例

2026-10-09（Asia/Shanghai），157/158方案已通过。

- SIZE-01：现有empty-content-hide浏览器夹具挂载真实SidebarWindowControls（放于原按钮之后以保留Tab顺序），读取真实左右收起button内SVG边界。所有contained检查同步断言两者宽高相等且等于当前root rem；修改前14/16尺寸差异必须导致功能RED。
- SIZE-02：沿用EMPTY-01–05现有8例、darwin/Web/win32、字号11/14/24、实时zoom .75..2及Windows fallback45/env注入48矩阵；按钮仍24px默认点击区、工具条位置及窗控/菜单间距不变，鼠标/Tab/Enter/Space和最后Tab回归继续运行。
- SIZE-03：真实macOS隔离完整Electron原组件同步采样左右SVG宽高，默认16px、实际zoom/font十组均与root rem相等；继续执行真实CUA点击、键盘、重开AI恢复、最后Tab流程。证据在implementation-48及每次独立运行子目录；旧47证据保留。Windows矩阵不是原生目标机验收。
- SIZE-04：完整活动core/browser、完整typecheck、UI/desktop构建及diff检查。测试夹具依赖生成物的browser必须在构建结束后运行，不与重建.next并行。只新增有限台账记录，未执行Windows原生或安装包不算通过。

本次不增加纯class字符串镜像断言，而是扩大已有真实UI几何验证；直接比较左侧真实SVG及root rem，覆盖用户实际提出的大小一致要求。
