# 快捷键配置与设置子框独立代码审核

日期：2026-10-07（Asia/Shanghai）。范围：`desktop/core/shortcuts.ts`、`src/components/desktop/ShortcutSettings.tsx`，以及 `SettingsDialog.tsx` 的快捷键页接入。定向阅读设置写入 store、共用 Dialog 与已批准菜单/快捷键契约。CodeGraph 工具当前不可用，采用已定位文件阅读。实现修复由主代理完成；复审代理按后续授权仅补 `tests/unit/shortcut-settings.test.ts` 与本记录，未修改组件/core，未控制浏览器或原生 App。

## 最终结论

**本批有限范围审核通过。** SHORT35-01–07 已闭合，没有范围内待处理阻断。核心 3 项与组件 4 项共 7 个顶层测试独立执行全部通过；另复核主代理实际 macOS Electron 的定向脚本、结果与截图。结论仅覆盖配置编辑规则和设置交互，不表示 Monaco 全动作、命令执行/菜单同步、Windows 或正式桌面业务验收完成。

## 问题与闭合

| 编号 | 发现与原证据 | 最终修复及复核 |
| --- | --- | --- |
| SHORT35-01 · 已闭合 | 子代理实际 TSX 逻辑探针确认录 F24 后 focus 返回输入框会重新 arm；repeat 又仅在输入框处理，返焦保存后没有整个录制/冲突层守卫。后者起初是源码确认。 | 移除 onFocus 自动 arm，只由打开/点击/显式重录/追加启动。window capture 在草稿存活期间消费 repeat/IME/229/Dead；组件回归证明焦点返回不重录、Tab 正常放行、Tab/Escape 本身可录、返焦后的重复事件被消费。主代理实际 Electron 另验证 Shift+Tab/Tab 与重复 keydown，未称物理长按验收。 |
| SHORT35-02 · 已闭合 | 子代理延迟写入探针确认提交 F24 期间仍可录 F23，第一写完成会令 draft=null 丢弃新输入。 | pendingWrite ref 同步锁定写入与所有草稿/冲突动作，控件禁用，关闭也遵守提交边界。回归覆盖保存及冲突层 busy、禁止重复写/退出、失败保留输入和确认集合；当前实现不会在提交途中接受再录的新草稿。 |
| SHORT35-03 · 已闭合 | 子代理实际 TSX 探针模拟磁盘失败：冲突仍打开，错误只在被覆盖的录制层。 | 冲突层自身显示 role=alert，失败保留草稿并可取消/重试。组件回归使用两个不同 chord 冲突命令：失败不变，取消回录制不丢草稿，重试一次转移全部冲突索引并保留各命令其他绑定及另一平台。 |
| SHORT35-04 · 已闭合 | 子代理指出删除/过滤后无明确返焦，不能依赖已经删除的 opener；原结论为源码缺项，未冒称修复前原生复现。 | 列表按命令 ID、索引选择相邻编辑/添加，行消失选择搜索框，Dialog finalFocus 与删除 rAF 使用同一目标。组件回归覆盖最后/中间项删除、搜索行消失的编辑/删除；主代理实际 Electron 验证保存返焦添加及删除过滤后返焦搜索。 |
| SHORT35-05 · 已闭合 | 主代理补充发现连续组合后续段含 locked 默认 Cmd+Q 未拒绝，`shortcuts-locked-chord-red.tap` 为 3 项中 1 失败。 | 核心逐段核验 OS 保留集合及 locked 默认组合，第二/第三段 Cmd+Q 回归拒绝；最新核心 3/3 独立通过。不能仅靠整条组合的前缀比较保护后续段。 |
| SHORT35-06 · 已闭合 | 主代理真实 macOS Electron 发现冲突跳转时双层同时关闭，嵌套 finalFocus=saveButton 抢走列表焦点。受控逻辑 harness 没有模拟 Base UI 关闭动画，不能证明此竞态。 | 嵌套 finalFocus 根据录制草稿存活情况返回保存或列表目标；实际 Electron 重建后的脚本断言搜索为 file.save 且目标添加按钮聚焦。来源明确是主代理原生发现/复测，子代理只复核源码和证据。 |
| SHORT35-07 · 已闭合 | 主代理实际 Electron 发现在快速打开后 Escape 可能先于 Base UI 初始焦点就绪而 dismiss；仅 input capture 不足。 | recording 阶段 window capture 先消费并记录首个按键，无草稿立即移除监听。源码确认仅录制且未提交/无冲突时记键，录完撤掉录制状态；组件首个测试增加尚未转移焦点时 Escape 捕获，实际 Electron 脚本同样直接打开后录 Escape。 |

初始核心 RED 见 `docs/evidence/implementation-02/shortcuts-red.tap`（3/3 失败）；locked 后续段 RED 见上表记录。前三项 UI 问题先以实际 TSX 受控探针确认，再由主代理修复；4 个可重复组件测试随后整理补齐，不将其称作修复前已存在的 TDD 文件，也不把探针失败和 harness 自身调试错误混为产品 RED。

## 规则与状态边界

物理 code 捕获普通字母/数字/标点及小键盘，macOS Cmd 与 Windows Win 命名独立；修饰键单按、IME/229、repeat、Dead/Unidentified 不构成新绑定。Plus 与 Shift+Equal 相同、NumpadAdd 独立，至多三段且拒绝重复修饰符。冲突遍历全部命令/绑定、只跳过编辑项，涵盖别名与 chord 前缀；global/text 与相关局部重叠，互斥局部允许复用。转移先校验再复制、仅移除冲突索引；空数组不会回落默认，同命令重复、locked 和每段系统保留组合拒绝。

搜索匹配命令/ID/作用域/默认及任意当前绑定，每个键帽单独编辑/删除。store 串行读取最新确认状态，编辑/删除检查原索引值；提交只更新当前平台 namespace。恢复默认有确认/取消、提交锁和返焦，仅清当前 namespace。组件回归验证取消无写入，确认后 macOS 清空覆盖而 Windows 保持原值。这是配置规则验证，不证明两个真实 OS 上全部组合均可被应用收到。

长冲突动作按钮改为可换行、不限单行高度，源码不再拼长命令名后强制 nowrap。已有原生截图显示搜索/单行条目和跳转后布局；没有将它称作多冲突/所有窄窗/全部缩放的完整视觉验收。SettingsDialog 仍按快捷键分类挂载该组件；其他尚在开发的设置页不纳入本记录的完成范围。

## 验证与实际限制

独立 Node 24.18.0 执行：

```text
node --import tsx --test tests/unit/shortcuts.test.ts tests/unit/shortcut-settings.test.ts
tests 7, pass 7, fail 0, cancelled 0, skipped 0
```

另有针对实际 helper 的定向断言（全部冲突索引/不可变转移/locked 段/别名/空绑定/三段及12项上限/Windows capture）；这些独立探针不并入上述 7 个顶层测试。两平台当前静态 registry 默认键均有效、默认集合无冲突。添加测试后的独立 `tsc --noEmit --incremental false --pretty false` 通过，未写 App 构建产物。

4 个组件单元测试以内存转译执行真实 TSX，以可控 hooks、可见元素树、focus ref 和设置替身断言公开值/禁用状态/可见错误/写入次数/确认集合/焦点目标；不读取内部 hook state 下标。它们不替代 Base UI 的 focus trap、关闭动画、浏览器默认按键、真实磁盘失败或 OS 拦截。嵌套跳转曾在这种逻辑回归通过后仍被真实 Electron 发现，故以主代理原生复测单独闭合，没有把替身结果提升为 App 验收。

主代理运行 `scripts/smoke-electron.mjs`，复审代理阅读 `docs/evidence/implementation-02/native-smoke.json` 与 `native-shortcuts.png`，并核对实际脚本断言：F8 录制、Shift+Tab 回框不自动 arm、Tab 导航、保存/删除过滤后返焦、Escape/Enter 重复 keydown 不关闭/保存、Cmd+S 录制及冲突按 ID 跳转。来源为真实 macOS arm64 开发 Electron 窗口；键盘由 Playwright Electron/CDP 驱动，两次 keyboard.down 产生 isAutoRepeat，不是物理长按、IME/非美式布局或 Windows OS 验收。本代理没有独立启动/重跑原生窗口，结果执行者是主代理。

主代理另报告整体核心证据 85/85；本记录未独立重跑或将其他模块的通过数算进本批 7 项。真实 Monaco 全动作注册表、App 命令执行路由/原生菜单动态同步、双平台 OS 按键、故障注入完整场景及正式顶层业务验收仍属后续工作。没有将配置中的命令条目或本批叶检查当作全部动作已能执行，也未据本记录把正式测试用例改为 passed。
