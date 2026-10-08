# 菜单、快捷键调度与普通输入独立代码审核

- 日期：2026-10-07
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批实现作者。
- 状态：**限定代码审核通过。下列已发现问题修复后独立复审通过；不代表全部命令、原生菜单或桌面验收完成。**
- 范围：共享静态命令与两平台菜单映射、确认绑定来源、`ShortcutDispatcher`、命令目标所有权、Controller 的普通输入/弹窗/连续组合接线、普通 input/textarea 命令适配、普通输入的 `nativeTextEdits` 与窄剪贴板 IPC。runtime 元数据合并只审核身份与绑定来源，不据此证明完整 Monaco 枚举。AI composer、引用候选、输入历史及 contenteditable 分支由47另审；Monaco/格式动作由48另审。
- 未控制浏览器、运行 Electron、调用真实剪贴板或修改产品实现。新增测试与本审核证据独立保存，没有修改作者测试。

## 发现与复审

### UI46-01 · P2 · 真实键盘事件字段被对象展开丢弃（已修复）

首审 Dispatcher 将实际事件展开后传给 `capturedKey`。原生 KeyboardEvent 的按键字段不是可展开的可枚举自有数据，因而实际 Controller 收到 Cmd+K 等事件时，调度器无法取得 key/code/modifier；原纯核心用例使用普通对象，没有证明这条接线。

独立 KEY46-01 使用不可枚举字段的 DOM 形状 Event，Cmd+S 得到 none；实际 TSX Controller 的 CTRL46-01 也未消费组合首段。两份行为 RED 已保留，没有把合成事件说成物理 OS 按键。修复显式读取所需字段；独立核心与实际 Controller 回归通过。

### UI46-02 · P2 · 提前返回没有清除旧连续组合（已修复）

Controller 在 IME、已经被其他组件消费的事件和未自定义的原生局部键上提前返回，绕过 Dispatcher 的清理逻辑。旧首段可能继续等待，使后续单键被错误拼接。

该项由源码检查发现；首轮 CTRL46-01 的实际失败首先暴露 UI46-01，CTRL46-02 首轮因首段尚未启动而通过，不能把它称为这一缺陷的独立修复前 RED。修复后 CTRL46-01/02/05 明确先验证/进入首段，再分别插入 IME、正常原生输入、已消费 Escape，后续 C 均不执行确认。原生局部输入仍收到其事件。

### UI46-03 · P2 · 原生菜单事件越过设置/录制屏障（已修复）

原菜单事件路径直接使用保留的正文目标，设置模态层或快捷键录制打开时，file.save 仍执行背后的编辑器命令。CTRL46-03 执行实际 Controller 监听器重现，得到保存调用的行为 RED。

修复对菜单事件实施录制及模态屏障。CTRL46-03 验证关闭屏障后同一目标仍能保存；CTRL46-06 额外验证对话框自身输入的 text.copy 仍允许，录制时继续拦截。没有简单禁用全部菜单编辑，也没有把受控屏障测试说成原生菜单焦点验收。

### UI46-04 · P2 · 第二段前按修饰键破坏有效组合（已修复）

首轮修复把所有无法形成 stroke 的事件都视为中断。真实 Cmd+K Cmd+C 可以先释放再按 Meta，纯修饰键应保留首段，却被清除。CTRL46-04 保存了明确 RED：应确认一次，实际没有确认。

最终仅对非纯修饰键的无效事件清除首段；Control/Shift/Alt/Meta/AltGraph 保留等待状态且不消费。有效后续 Cmd+C 执行一次。Dead/Unidentified、IME、失焦和配置变化仍分别清理。

### UI46-05 · P2 · 异步原生编辑落到后来聚焦的输入框（已修复）

原输入适配在发送前核对 A，但 `nativeEdit(id)` 经 IPC 到 main 后调用 WebContents 的当前焦点操作。投递前用户已聚焦 B，粘贴会修改 B。

INPUT46-01 执行实际 Controller、输入适配与 main `executeCommand` 函数体，受控延迟 IPC 和 WebContents 的焦点接收行为；A 发起 paste，B 获得焦点，再投递，B 实际变成 `B + clipboard`，得到 RED。这不是系统剪贴板或 Electron 时序实测。

最终 main 拒绝 renderer 请求的 `text.*` 直接编辑；菜单仍先发回 renderer。普通 copy/cut/undo/redo 在已核验控件上同步执行 Chromium 操作。粘贴只通过受信主 frame、已聚焦应用窗口读取有长度上限的文本，返回后检查原控件、可写性、值、选区和事件 epoch，再执行 `insertText`。不在 main 对迟到请求选取新的焦点控件。

独立回归确认粘贴请求实际到达读取桥接（reads=1），切换 B 后其值保持不变，迟到文本没有编辑 B。该正向入口断言避免用“根本未执行”伪造安全通过。同步操作/正常粘贴和其他所有权变化另由本次合跑中的8项 adapter 用例验证操作意图；Chromium 撤销效果仍需原生验收。

### UI46-06 · P2 · 新输入适配缺失控件实参（已修复）

替换桥接后，`nativeTextEdits.run(id, control)` 需要原控件，输入适配声明和调用却仍只有 id。独立实际链路未到达 clipboard read，reads=0；保留第二份接线 RED，不把新模块自身8项 GREEN 外推为接线成功。

输入作者明确传入捕获的同一 control，并补自己的六类 native edit 身份断言。最终实际 Controller/input/nativeTextEdits 合跑通过。作者旧两文件冻结清单保留历史，新清单为 `input-target-wiring-frozen.json`，独立核对两份 SHA 匹配。

### UI46-07 · P2 · 窗口失焦仍可能应用迟到粘贴（已修复）

主进程读取时的 isFocused 不能代表回执返回时窗口仍聚焦；窗口失焦后 document.activeElement 通常还保留 A。独立源码检查提出缺少窗口失焦守卫，主代理随即补 `document.hasFocus` 与 window blur epoch。

NATIVE46-01/02 分别验证同一 activeElement 下失焦，以及失焦后返回同一窗口，都拒绝迟到 paste。两项首次运行前修复已落地，首次即 GREEN，**没有修复前 RED**。dispose 同时移除 document/window 监听并使等待中的意图失效。

## 范围内源码核对

菜单与设置使用稳定 ID 和同一平台绑定来源；第一项为主绑定，显式空数组不回默认，系统保留命令使用锁定默认。主进程只从已确认 revision 更新菜单映射，较旧回执不能覆盖新映射；Windows 弹出菜单使用当前映射。Electron 不可表示的多段组合保留文字显示，由 renderer 调度，不构造无效 accelerator。

Dispatcher 遍历所有有效绑定，按作用域/当前可用目标解析；不启用歧义命令，删除或改写默认绑定后拦截旧原生组合。连续组合有时间、焦点与配置边界，非重复动作拒绝重复触发。Controller 显式清理自身的提前返回路径，菜单/列表框、录制及已消费事件不能接续陈旧首段。macOS Ctrl+F2 仍让系统处理；是否被 OS 实际接受未在本审核验证。

CommandTargets 不从失效 owner 自动补选其他目标；捕获后执行前再次核对同一注册与 handler，重复 owner 不执行。普通输入适配排除 Monaco、正文编辑器、AI composer、录制框以及不可选择的 email/number 等控件。readonly 只开放适用选择/复制；password 不导出复制/剪切；IME期间不执行命令。焦点恢复回调令控件变只读时，编辑也再次拒绝。

普通光标、选择和删除使用 grapheme/word 边界，保护代理对、组合音标与 ZWJ；上下移动只实现硬换行列。删除通过原生 delete 保留撤销意图，失败且值未变时恢复旧选区，不直接赋值伪造撤销。确认/取消需要控件 owner 提供业务 callback；缺少 callback 时 disabled，不通用提交或模拟按键。本批没有声称已经把所有业务表单都接上这些 callback。

## 独立证据

所有命令、退出码、当前相关源文件及证据指纹见 `docs/evidence/implementation-07/46-independent-summary.json`。

- `controller-independent-red.tap`：首轮实际 TSX 3项，1通过/2失败，exit1；字段丢失及模态菜单保存的行为失败。另一项首轮通过不能证明组合中断已正确实现。
- `dispatcher-dom-independent-red.tap`：非可枚举键盘字段1项失败，exit1。
- `controller-modifier-independent-red.tap`：新增修饰键回归，6项中5通过/1失败，exit1。
- `input-native-owner-independent-red.tap`：迟到主进程粘贴误改 B，1项失败，exit1。
- `input-native-wiring-independent-red.tap`：新适配器调用缺少控件，1项失败，exit1。
- `native-window-focus-independent-green.tap`：失焦相关2项首次即通过；不列作TDD RED。
- `controller-independent-current.tap`：一个中间运行仍有控件实参错误，9项中8通过/1失败；不是最终证据。
- `controller-independent-fixes-green.tap`：最后4份独立文件10/10通过，exit0。此文件此前一次因新 composer 依赖尚未补 harness 而导入失败，已明确为测试适配问题，未列作产品RED；最终内容是补齐依赖后的真实行为运行。
- `46-independent-final-green.tap`：最后独立执行10文件，**54/54通过，0失败/取消/跳过，exit0**。构成为原菜单4、Dispatcher6、目标4、普通输入21、native edit8、runtime元数据1，以及本审核新增4文件10项。没有累计作者重复运行、RED或其他审核数量。
- `46-independent-typecheck.txt`：最后全项目 `tsc --noEmit --incremental false --pretty false` exit0，无诊断。类型检查包含当时工作区其他代码，但不据此扩展本审核功能通过范围。

测试使用实际核心模块/Controller 与有界 DOM、事件、IPC、编辑操作替身。检查行为和目标归属；不把 `execCommand` 替身记录当成 Chromium 历史、系统剪贴板或辅助功能验证。

## 未完成验收与结论

本批源码及受控接线没有剩余已发现阻断问题，可按上述范围通过。完整 Monaco 运行时动作/when 条件、格式及版本保存、AI composer 全域与引用候选另审；其状态不得由这里的54项替代。

原生菜单当前的 enabled 映射只直接禁用尚未上线的文档入口，编辑 owner/readonly 等依赖 renderer 执行门控；没有证明原生菜单随上下文实时置灰已完成。实际 macOS/Windows 菜单、全部副绑定/chord、物理长按、键盘布局/IME、真实剪贴板 copy/cut/paste 与 undo/redo、恢复焦点及真实控件业务确认/取消仍需正式测试。普通输入软折行/Bidi、平台原生词边界等也未由当前硬行适配支持或验收。

没有运行 Electron、创建正式GUI验收结果或标记正式顶层case通过。整体桌面应用验收仍未完成。
