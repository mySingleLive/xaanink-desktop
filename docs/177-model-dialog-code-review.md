# 配置模型目录与剪贴板修复独立代码审核

日期：2026-10-09。依据：173/174 方案、175/176 用例。审核仅涉及本轮共享公开目录及型号常量、输入菜单协议/main/preload、模型对话框、输入命令与原生编辑、桌面命令控制器、相关 unit/browser 测试及 `scripts/smoke-byok.mjs`。未读取、输出或使用真实凭据，未执行供应商接口，未修改实现。

## 最终结论：通过（产品代码与验证驱动审核）

产品实现的两项 P2 及后续验证驱动的剪贴板恢复 P2 均已修复并独立复审关闭，无剩余必须修复的代码问题。审核代理独立执行受控单元 112 项及真实 Chromium 6 项，全部通过；验证脚本最终修订语法检查退出 0。本结论允许继续原生执行和 178 验收审核，不代替原生剪贴板、系统菜单及完整回归的实际执行证据。

### 首轮发现

1. **P2，目录返回覆盖错误型号元数据：已修复并复测关闭。** 请求开始时型号为 A，查询期间用户从公开候选选择 B；原成功回调用闭包 `draft.modelId` 查 A，然后把 A 的容量、思考档位和默认值写入当前 B 草稿。修复后在 `setDraft(before => ...)` 内按当前 `before.modelId` 从本次合法合并目录精确查找。`model-settings.test.ts` 新增 D04/D05 回归以两个型号不同容量/档位验证保存的 B 数据。审核代理独立执行相关单元用例通过。
2. **P2，公开文本目录遗漏：已修复并复测关闭。** 首轮阿里精确列表缺少来源明确列出的 `qwen-plus-character-ja`、`qwen-flash-character`、`qwen-plus`、`qwen-max`、`qwen-flash`。修复补齐 [官网文本目录](https://help.aliyun.com/zh/model-studio/text-generation-model) 尾部 33 个精确 ID，包含文本表列出的 `qwen2.5-omni-7b`，新增精确 ID 回归。Anthropic 首轮仅列最新四项，修复补齐 [官网 lifecycle 表](https://platform.claude.com/docs/en/about-claude/model-deprecations) 的 9 个其他 Active 型号；旧容量未核实则留空，不统一套用 1M/128K。3 个 Mythos 受限候选默认禁用，未到退休日期的 Sonnet 4.5 有弃用及计划下线提示，退休日期后排除。新增目录及权限回归独立通过。

同一目录发现还包含下线筛除遗漏：首轮 `excludedBuiltinModel("anthropic","TEXT","claude-opus-4-1-20250805")` 为 false；用纯本地假 catalog 追加该 Retired 型号，`modelChoices` 将其纳入可选（审核代理受控输出 `{excluded:false,liveRetiredSelectable:true}`）。修复加入官网全部 19 个 Retired 精确 ID 排除表，live 追加不能恢复；旧选择回插复用该排除函数。测试同时验证 Sonnet 4.5 的 2026-11-30 日期边界及受限候选改目录后撤销启用。问题关闭。

### 已核查边界

- 公开目录在无 Key 时可供选择；同 ID 合并保留实时 `available:false`，订阅型号默认禁用，当前 Key 的实时 `available:true` 才启用；改 Key 清除目录，保留型号但撤销旧启用。共享能力表的下线/OTHER、阿里纯编辑和 Anthropic lifecycle 筛除在合并和旧选择回插中继续生效；未列出候选保持权限未知。
- 选择、取消和查询不创建配置；新模型保存仍要求 Key、单选、重复检查和手动保存。旧保存的下线选择可保留显示和无 Key 元数据保存，不作为新候选恢复启用。
- 标记密码框复制/剪切只写选区；写入失败或迟到不得删除；成功后原生 delete，粘贴原生 insertText。字段保持密码类型，普通密码框复制/剪切保护及 readonly/disabled 语义保留。
- API Key 默认快捷键仅经现有 dispatcher 的已确认绑定路由；用户移除/改绑后不强行执行旧默认绑定。
- 菜单 IPC 只含六个严格布尔能力；main 仅构造固定有限菜单命令，不使用直接编辑 webContents 的 role，不经全局 executeCommand 转发。可信主窗口/frame 在打开及结果返回时校验。菜单替换、关闭、blur、窗口 closed 和 popup 异常释放 Promise；renderer 对原控件检查连接、焦点、epoch、快照和当前命令能力，再执行。
- Anthropic 四个新型号及其 1M/128K 容量与 [官方总览](https://platform.claude.com/docs/en/models/overview) 一致；Grok 4.7 的容量和档位与 [官方型号页](https://docs.x.ai/developers/models/grok-4.7) 一致；阿里图片候选与 [官方图片表](https://help.aliyun.com/zh/model-studio/image-model) 的文生图分类相符。这里核查公开元数据，不声称账户真实调用成功。

### 审核代理受控验证

使用 Node v24.18.0：

```sh
/Users/dt_flys/.nvm/versions/node/v24.18.0/bin/node --import tsx --test tests/unit/builtin-model-catalog.test.ts tests/unit/input-context-menu.test.ts tests/unit/input-commands.test.ts tests/unit/native-text-edits.test.ts tests/unit/native-text-edits-review.test.ts tests/unit/clipboard-ipc.test.ts tests/unit/model-settings.test.ts
```

首轮 111 通过。目录补丁后的最终独立重测 112 通过、0 失败、0 取消、0 跳过，退出 0，耗时 514.003833 ms。

独立尝试执行 `tests/browser/api-key-clipboard.test.ts` 时，默认 Playwright headless shell 未安装，退出 1，六项在 before 启动阶段失败，未进入行为断言；随后明确使用已安装 Google Chrome，在沙箱内仍因启动 SIGABRT 退出 1。这两次不能记为行为断言失败或浏览器通过。

按本轮受控验证授权，经自动审核允许启动已安装浏览器后，实际执行：

```sh
XAANINK_TEST_CHROMIUM='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' /Users/dt_flys/.nvm/versions/node/v24.18.0/bin/node --import tsx --test tests/browser/api-key-clipboard.test.ts
```

六项通过、0 失败、0 取消、0 跳过，退出 0，耗时 4273.878 ms。包括密码选区 copy/cut、受控 React 更新与原生 undo/redo、粘贴 literal text、复制/剪切/粘贴分别改绑和移除、真实 DOM 的失焦 A→B→A。页面网络全部 abort，剪贴板/菜单桥使用内存公开假值；此结果不代替操作系统剪贴板和真实原生菜单验证。

### 原生验证边界

`smoke-byok.mjs` 为 20 个供应商/类别执行空 Key 目录与实际单选；`XAANINK_NATIVE_INPUT_MENU=1` 时读取实际系统剪贴板并等待真实 macOS 菜单操作，脚本不直接调用 MenuItem.click 或伪造 invoke 返回。证据记录编译 SHA、网络守卫和 `nativeMenuInteraction`，开关关闭的执行不能覆盖原生菜单用例。原剪贴板只在受控 main 内存保存并在 finally 恢复；不会写入证据。最终仍须执行重新构建后的 macOS Electron、CUA 菜单点击及全部 175 用例覆盖审核，不能以代码审核代替。

### 测试脚本补充复审：通过

默认粘贴的原生用例现依次断言 Cmd+V 后值为公开粘贴假值、Cmd+Z 还原、Cmd+Shift+Z 重做恢复粘贴值、再 Cmd+Z 还原，并在所有断言通过后追加 undo/redo 检查记录。复读确认没有跳过命令、直接赋值或模拟重做返回，符合 175/K02 的原生重做要求。Node v24.18.0 的 `node --check scripts/smoke-byok.mjs` 退出 0；实现代码未变，177 的代码审核通过结论保持。本补充是脚本审核通过，实际原生重做是否执行成功仍须由重新构建后的运行记录及 178 验收证据确认。

随后增加的唯一测试窗口标题也复审通过：`electron.launch` 返回的受控测试进程在 `firstWindow` 后，通过该进程的 `app.evaluate` 设置自身 BrowserWindow 标题为“玄印写作 · 配置模型回归验证”。没有查找或修改用户既有进程/窗口，没有产品源变更。再次 `node --check` 退出 0。CUA 后续仅定位该标题的隔离窗口，并应在实际操作前确认标题匹配。

### 旧 Controller 夹具补齐依赖复审：通过

`composer-command-review.test.ts` 与 `native-command-priority.test.ts` 的差异均只有原 bounded `input-commands` mock 增加 `installInputContextMenu: () => () => {}` 和 `isAPIKeyControl: () => false`。测试目标为 composer/button/editor，明确不进入本轮 API Key 特判；原有测试项和断言没有删减或放宽。审核代理独立以 Node v24.18.0 执行这两个文件，14 通过、0 失败、0 取消、0 跳过，退出 0，耗时 676.813625 ms。

该夹具修复不更改产品实现，代码审核通过结论保持。首轮全量 1709 项中 1699 通过、10 项初始化失败是主代理报告的历史结果，须保留日志；本次 14 项通过不能代替修复后完整核心/browser 回归，最终由 178 验收审核核对。

### 旧浏览器用例关闭同步补丁复审：通过

`configuration-transfer-ui-review.test.ts` 的 CFG62-U07 差异仅在实际 Escape 后，增加对应 listbox 的 `waitFor({state:'hidden',timeout:2000})`，然后继续原 `count() === 0`、映射触发器焦点、窄屏对话框边界与三个 footer 按钮可达断言。没有固定 sleep、没有 mock 关闭、没有放宽计数或焦点预期，也未改产品 `ConfigurationTransfer`。这是等待异步关闭完成的明确状态同步；超时仍失败，代码审核结论保持通过。

主代理报告首轮 199 项 browser 为 198 通过、1 项 CFG62-U07 失败，原产品未改时单项复测通过，历史日志须保留。审核代理本次只复核差异和原断言，为避免干扰正在进行的全量回归未重复启动浏览器；补丁后的完整 browser 通过结果及历史失败由 178 验收证据核对。

### 原生候选门户就绪同步补丁复审：通过

`smoke-byok.mjs` 点击“可用模型”后新增命名 listbox 的 visible 状态等待，明确 `exact:true` 和 5000 ms 上限；随后仍断言该 listbox 的 option 数量大于 0，并只在该 listbox 内选择未禁用的第一个 option。原空 Key、字段协议/地址隐藏、已选择显示和配置不落盘断言保留。没有固定 sleep 或模拟候选，限定门户还防止误取供应商选项。脚本语法检查 `node --check` 退出 0，没有产品源变更，代码审核通过结论保持。

主代理报告首次原生运行在门户就绪前 count 为 0 退出 1，尚未进入剪贴板阶段，须保留 `native-first.json`；本补充不把该次执行计作原生剪贴板/菜单通过。主代理报告的最终核心 1709/1709、browser 199/199、build/typecheck 退出 0 及随后原生重跑，统一待 178 独立验收核对实际文件。

### 原生剪贴板焦点同步辅助复审：通过

脚本在进入剪贴板断言前，仅输出固定阶段及自身测试进程 BrowserWindow 的 `focused` 布尔值、固定就绪标记；随后以 120 秒上限等待该窗口 `isFocused() === true`。未调用 BrowserWindow.focus，未修改或绕过主进程剪贴板聚焦校验，没有注入复制命令、删除原断言或输出剪贴板/Key 内容。等待发生在填入公开假值和设置选区之前，允许 CUA 经真实系统界面点击唯一标题的测试字段激活窗口。`node --check scripts/smoke-byok.mjs` 再次退出 0，代码审核通过结论保持。

主代理报告第二次原生运行完成 20 组目录断言后，默认 Cmd+C 的实际系统剪贴板谓词未在期限内成立；`native-second.json` 必须保留失败。该次故障原因尚未由复测证实，不将“缺少焦点”写成已确认结论，也不将新增等待当作剪贴板/菜单通过。最终实际交互、保护条件仍生效及原全部断言的运行结果待 178 核对。

### 真实字段点击及 document 焦点门闩复审：通过

后续辅助补丁在自身 API Key 元素注册一次 pointerdown 监听，仅记录 `event.isTrusted` 布尔；进入原剪贴板步骤前要求该门闩为 true、`document.hasFocus()` 为 true，并继续要求 own BrowserWindow 聚焦，两段均有 120 秒上限。输出只增加 `documentFocused` 布尔，没有 Key 或剪贴板内容。门闩不执行编辑命令或设置焦点，不写产品/桥状态；原 copy/cut/paste、undo/redo 断言保留。Node v24.18.0 脚本语法检查再次退出 0，辅助补丁审核通过。

主代理报告第三次日志中 BrowserWindow focused 为 true，而默认 Copy 仍失败，故撤回“已确认窗口失焦”的原因判断，保留 `native-third.txt`。本门闩只提供更严格的交互前置条件，尚不证明故障已修复；`event.isTrusted` 也不能独自证明输入来自 CUA，最终证据需对应完整项目 Electron.app 路径、唯一标题窗口的实际 CUA 点击及原断言结果。不得操作仅 bundle 名相同的其他实例。

### Copy 改用真实系统按键驱动：准备补丁已复审通过

复读确认原 CDP Meta+C 改为固定 `NATIVE_KEYBOARD_READY_COPY` 标记及 120 秒内等待实际系统剪贴板等于选区 `native`，没有写入期望值或注入复制命令，密码类型和其余原断言保留；脚本语法检查退出 0。第四次报告 window/document 焦点均为 true、实际 CUA 点击 API Key 后 CDP Copy 仍失败，须保留 `native-fourth.txt`，不再归因窗口失焦，也未证明是驱动差异。

首轮驱动未重置剪贴板，若原剪贴板已为 `native`，等待可在未收到真实 Cmd+C 时直接通过。后续修订已在保存原剪贴板之后、填入选区及发出 COPY 标记之前，通过自身测试进程的实际 Electron clipboard.writeText 写入公开 `native-before-keyboard-copy`，与最终期望严格不同。复读写入顺序及再次语法检查退出 0，准备补丁通过；原剪贴板仍在 finally 恢复，未改产品桥、权限或最终谓词。本准备是脚本审核，不是 K01 执行成功证据。

主代理报告第五次实际 CUA Cmd+C 后，原实际系统剪贴板选区谓词仍未通过，保留失败且不推断原因。后续诊断只能输出固定公开事件及布尔状态，不能记录字段值、剪贴板内容或真实凭据；只有原结果断言通过并具备实际交互证据，才可记为原生复制通过。

### 原生 Copy 失败后的路由定点复核

对 `DesktopCommandController`、`command-scope`、dispatcher、命令 owner 注册、`input-commands`、`native-text-edits`、preload/main 剪贴板桥及实际构建的 renderer 静态代码再次只读核查，暂未找到可证的文本转换或固定阻断缺陷。标记密码框精确取 `value.slice(selectionStart,selectionEnd)`，preload 原样发送字符串，main 仅作可信窗口/frame、窗口聚焦及 1MB 校验后调用实际 Electron `clipboard.writeText`。正常快捷键接管在启动异步命令前同步 `preventDefault` 和 `stopImmediatePropagation`；后者阻止该次事件继续到 document，故 document 上的 keydown epoch 监听本身不会撤销这次已接管的 copy。输入、composer、preview 与 Monaco owner 的接受范围互斥；应用菜单的 text 命令没有直接编辑的 role，产品没有 before-input-event 文本编辑处理器。

上述结论是静态路由核查，不证明原生 Copy 已执行成功。Controller 仍有 bootstrap/已消费事件/IME/录制状态/菜单焦点/已确认绑定等合理早退条件，命令 owner、实际字段焦点及 main 聚焦保护也可能拒绝当前执行。主代理报告第八次真实 Cmd+C 到达 main 和标记密码框、选区长度为 6、窗口及 document 聚焦，但选区剪贴板谓词仍失败；当时微任务读取的 `defaultPrevented:false` 可能早于后续 listener，不能据此判断 Controller 未接管，更不能修改验收结果为通过。

第九次诊断辅助补丁已复审通过：完成首次工作台启动后 reload 使 init 监听先安装，以 setTimeout(0) 读取完整派发后的 defaultPrevented；实际 clipboard.writeText 包装先同步调用原方法再记录是否等于两个公开假值的布尔，结果原样返回；系统剪贴板只输出与 sentinel、公开完整 fixture、六个 mask 字符、原剪贴板或空字符串的比较布尔，原剪贴板仍只存内存并在 finally 恢复。没有假的返回值、期望值写入或权限绕过。Node v24.18.0 的脚本语法检查退出 0。第七次过早 reload 引起的启动失败及后续真实复制失败须继续保留，最终执行诊断和原全部断言仍待实际运行；原生剪贴板/菜单验收保持未通过。

### Electron 44 异步剪贴板定义与测试驱动复审

已独立核对安装包 `node_modules/electron/package.json` 为 44.6.0，`electron.d.ts` 的 `readText():Promise<string>`、`writeText():Promise<void>`、`read():Promise<ClipboardItem[]>`、`write(items):Promise<void>` 与 [官方 API](https://www.electronjs.org/docs/latest/api/clipboard) 一致。产品 main 的读写均已有 await，preload 返回 invoke Promise，renderer 等待写入；本轮没有因此修改产品实现。

旧脚本在 app.evaluate 回调内直接以 `clipboard.readText() === 'native'` 比较 Promise 与字符串，谓词恒为 false；对 sentinel/mask/empty 等直接比较也无效，不能据其 false 推断系统剪贴板的实际内容。旧备份把 readText 的 Promise 存为原值，finally 的 string 检查不成立，因而没有执行预期恢复。此前记录中“在 finally 恢复”的设计意图没有实际成立，不能保留为已执行的事实；早期运行可能留下公开测试文本，不能从未保存的原内容重建恢复。第九次 writeText 包装原样返回 Promise，没有改变其行为，但之前认为调用同步完成的表述在此更正；早期真实失败日志继续保留为测试驱动失败，不证明产品 Copy 失败。

当前 readText 谓词已改为 async/await，各公开写入的 Promise 均由 app.evaluate 返回并被外层等待；增加写入后 sentinel 实值读回，实际 CUA Copy 标记、原选区字符串、密码类型、cut/paste、undo/redo 与菜单断言保留，去掉临时诊断包装和 reload。这部分修复符合定义，关闭异步谓词问题；实际原生执行结果仍待确认。

**P2，原 ClipboardItem 备份仍不可恢复：首轮阻断，后续修复并复审关闭。** 首轮修订保存 `await clipboard.read()` 的返回对象后直接 `clipboard.write(items)`，但 Electron 44.6.0 [官方 ClipboardItem 源码](https://raw.githubusercontent.com/electron/electron/v44.6.0/lib/browser/api/clipboard-item.ts) 的 kToNative 明确拒绝 read-side 对象；[官方 native 源码](https://raw.githubusercontent.com/electron/electron/v44.6.0/shell/browser/api/electron_api_clipboard.cc) 也明确 getType 按需读取当前剪贴板、write 拒绝 read-side 项。该保存仅保留读取器，不能恢复被覆盖的 payload；finally 的 catch 吞掉错误还能留下已写的 passed:true 报告。

须在任何覆盖之前，逐 item 的所有 types await getType，把各 Blob/bookmark 完整实化到主进程 RAM，再 new ClipboardItem 构造可写的备份；空剪贴板也应明确处理。任何备份失败必须在写 sentinel 前退出，恢复失败必须以固定脱敏失败显式反映并避免报告通过，关闭进程和清理隔离目录仍需执行。不得把数据或格式 payload 发到 renderer、输出或写文件。审核代理没有读取实际系统剪贴板或运行供应商请求。

最终修订已按上述要求落实并复读确认：覆盖前等待 readText/read，逐项等待全部 getType 后构造新 ClipboardItem，快照仅存自身 main RAM；read 返回空 types 的项目跳过，空快照恢复使用 clear。备份失败只给固定脱敏错误，且 sentinel 尚未写入。restoreClipboard 等待 write 后严格核对恢复文本，再清除 RAM；恢复失败不吞掉，在生成 passed:true 证据之前必须成功并追加恢复检查记录。finally 再尝试恢复，通过嵌套 finally 保证即使恢复或 app.close 失败仍执行隔离 root 删除，错误继续传播。语法检查再次退出 0，P2 关闭，177 恢复通过结论。

主代理报告第十次仅在实际字段激活前失败，未进入剪贴板备份/覆盖阶段，记录须保留；第十一次将按原全部断言继续真实执行。这些执行结果、恢复检查及实际 CUA 菜单操作统一待 178 核对，当前不将未取得的原生结果记为通过。
