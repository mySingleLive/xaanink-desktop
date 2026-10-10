# 三栏顶部高度恢复测试清单

1. HEIGHT-01：Windows 三个真实标题区域同为 44 DIP，五 zoom（.75/1/1.25/1.5/2）、三字号（11/14/24）、空/单/八 Tab；正文紧接新标题底部，单/多 Tab scroller 不产生纵向溢出。
2. ALIGN-01/HEIGHT-02：全部现有真实按钮/SVG 使用独立固定几何预期：sidebar/chat/menu 按钮28、content工具24、tab close15，普通SVG16、tab close SVG12、Tab图标14；width/height分别符合此值，top为16减半尺寸（0.6 DIP原 border/取整容差），所有 centre 保持16 DIP，Tab高度32。保存修改前 desktop.css 仅作证据，不复制到长期测试夹具；测试不通过重新读取实现声明来推导预期。
3. 原 ALIGN-02/03：Windows 窄布局切换三 pane 不下推标题；后退/前进/显隐/全屏/菜单鼠标及键盘/Tab关闭真实 handlers 保留。空态、单/多Tab均保持标题高度，scroller scrollHeight <= clientHeight+1，容许fractional CSS尺寸取整。
4. 原 ALIGN-04：Web/mac 默认三行44 CSSpx不变；作用域以实际样式/源改动核对，平台样式切换只属 browser 夹具，不计原生 mac 通过。
5. 本机 Windows：新包使用隔离真实 fixture、真实组件，读取标题/按钮/SVG几何，与上轮 geometry-final 原生相同DPI/zoom的坐标对比。Sky鼠标点击最大化/还原，截图确认顶部留白、32 DIP原生窗控未变，最后原生X关闭。新包应用不会读取作者目录。

RED：在当前32 DIP产品CSS上先更新44期望及独立HEIGHT断言，记录明确几何失败；实现后同命令 GREEN。完整core/browser另运行并据实保留所有失败/取消，不把历史通过或本轮专项通过提升为正式整体验收。构建/包/来源一致性和原始截图须由子代理独立审核。
