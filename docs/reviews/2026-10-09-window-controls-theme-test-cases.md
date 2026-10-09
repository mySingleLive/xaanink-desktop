# Windows 窗控主题修复测试清单

前置：技术方案已由独立子代理审核通过。范围与方案一致，不替代完整业务、macOS 原生或全部跨平台验收。

## 自动回归

1. WTHEME-01：paper/ink 的透明 overlay、可读 foreground、44px 高度；启动底色等于 globals.css 的真实 background 令牌。
2. WTHEME-02：system 根据当次系统亮/暗解析；显式 paper/ink 与系统相反时仍保持明确选择。
3. WTHEME-03：应用更新调用真实 helper 的原生 setter；null/已销毁窗口无调用；非 Windows 不调用 setTitleBarOverlay。
4. WTHEME-04：使用 TypeScript AST 提取并执行实际 main 的 refreshMenus、原生外观同步函数和 nativeTheme updated 回调（不执行 main 启动/作者文件 I/O）。提交新主题立即同步，旧 revision 不回退，相同 revision 的新窗口继续应用。
5. WTHEME-05：实际 main 回调在系统色改变时只影响 system；无窗口时仍保留已提交的主题选择；重新打开使用该选择；启动订阅必须先于首次 loadURL，加载期间的系统事件仍可同步。
6. WTHEME-06：三个窗口构造均使用共享透明 caption 配置；主窗口创建使用当前已提交状态，维修/重定位使用其既有主题快照。静态接入审查与真实主窗口验证互补，不将构造源码检查描述为原生测试。

先新增上述测试并记录旧代码失败，再实现并重复测试。执行所有活动 unit/integration 用例、TypeScript、完整生产构建及 package 打包检查。现有 browser 用例如能在本机执行则执行；若遇到平台依赖须保留实际失败，不记为通过。

## 本机原生验证

采用 Electron 44.6.0、Windows x64，XAANINK_TEST_ROOT 指向新的隔离目录，不打开作者数据、不配置模型、不使用 HTTP 服务。Computer Use 截图必须包含原生 Windows 最小化/最大化/关闭，网页 capturePage 不能单独证明 caption 背景。

7. WTHEME-07：真实 React 工作台的 paper/ink 空态，右上 caption 与周围背景/纸纹连贯；在设置 UI 切换立即生效，符号清楚可读，关闭设置后仍一致。
8. WTHEME-08：右侧真实内容面板显示/隐藏、有 Tab/无 Tab 时仍透出当前面板底色。仅使用隔离夹具；不复制设计稿内容。
9. WTHEME-09：跟随系统模式和显式主题与系统相反时检查原生 caption 的正常/hover 状态（包括关闭的红色反馈），并检查非活动窗口的可读性。系统模式验证使用当次真实系统值；如以 Electron themeSource 驱动暗/亮事件，必须标为 Electron 内的受控系统事件，不能冒充 OS 设置实际切换。
10. WTHEME-10：真实原生最大化/复原/最小化/正常关闭与再次启动；已保存主题及透明 caption 跨进程保留。新安装包的解包应用在隔离根目录与 renderer CDP 离线条件下启动；只声明本次主题/窗控范围。

保存运行命令、计数、失败与范围、源文件依据、原生截图标识及构建产物摘要到忽略的 docs/evidence/window-controls-theme/。公开验证说明仅使用仓库相对路径，不包含作者资料或密钥。W03 台账只追加有限开发证据，正式总状态保持 planned。
