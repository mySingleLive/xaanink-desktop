# 47 · AI 输入框命令接线独立审核

结论：本轮限定范围通过。首审确认的两项 P2 缺陷由主代理修复，独立行为回归复核通过；没有改动被审实现。此结论不代表所有桌面快捷键或真实系统剪贴板已完成验收。

## 范围与方法

审核 `ChatPanel.tsx`、`composer-history.ts`、`composer-shortcuts.ts`、`composer-text-commands.ts`、`native-text-edits.ts`、`command-runtime.ts`、`DesktopCommandController.tsx`，并定向读取平台目录、命令目标与分发器。审核者自己的 Monaco 五文件不在此报告自审范围。

新增三个独立测试文件：`composer-command-review.test.ts`、`composer-text-edits-review.test.ts`、`composer-preset-review.test.ts`。用 TypeScript AST 提取实际 ChatPanel effect、命令注册和发送方式保存 callback，在受控数据/文档中执行；Controller 使用实际捕获监听和真实 dispatcher/command targets。剪贴板使用真实 composer 注册及 native edit guard，只控制 IPC 返回与 DOM/选区；设置保存使用真实串行 store，只控制存储回执。没有付费模型调用、真实用户数据或运行中 Electron 操作。

## 首审发现与修复复核

| ID | 严重程度 | 实际问题与触发 | 修复与独立复核 |
| --- | --- | --- | --- |
| CMP47-F01 | P2 | history effect 在恢复期已有 conversationId、messages 尚为空时调用一次性 seed；真实加载后被跳过，无法召回该会话既有输入。恢复期混有旧消息时，也会给新 owner 留下旧列表。 | 主代理增加 recoveryStatus=ready 且 !isLoadingConversation 守卫，明确取已加载消息。CMP47-01/02/14 覆盖先空后完成、恢复期旧消息以及 loading 尚未结束；各 owner 历史与未发送草稿保持。 |
| CMP47-F02 | P2 | 原 Web 的全局 Escape 监听在桌面提前返回，而 ai.stop 仅 composer scope/textarea owner。生成中点击输入框外按钮后 Escape 不停止。 | 主代理把停止命令设为 global 并在全局目标注册，保留 mention=false 互斥。CMP47-03 验证失焦停止；04 验证引用候选 Escape 先关闭、Enter 仅选中；15/16 验证模态屏障和用户改绑后旧 Escape 不执行。 |

首轮证据 `docs/evidence/composer-review/01-independent-red.tap`：6 项，3 PASS / 3 FAIL，退出 1，均为上述行为断言。修复后 20 项首复核见 `02-independent-green.tap`，退出 0。

## 最终验证

最终 `04-independent-final-green.tap`：31/31 PASS，0 跳过，退出 0。其中 24 项为本轮新增独立回归，7 项为已有 history、preset、catalog 用例；没有把 fixture 数量当作真实 App 场景数量。

验证覆盖：多发送绑定、删除默认 Enter、IME 不发送、引用 Enter/Escape 优先级；发送方式两个命令同一确认回执生效，额外绑定及 Windows 集合保留，冲突不发部分提交，磁盘失败保持原绑定；菜单重新聚焦捕获 composer 后单次粘贴，迟到返回跨焦点往返、选区/HTML 变化、合成、只读、卸载/断连、窗口失焦往返均拒绝；选区跨目标禁止 copy/cut；平台目录如实标注 composer/global scope，合并动态元数据保留静态互斥上下文与全部次级绑定。

全量 TypeScript 检查证据见 `03-independent-typecheck.txt`、`05-independent-final-typecheck.txt`（退出 0，空诊断）。父代理后来统一 command-scope 以避免正文 ViewZone 普通输入被接管；本审核仅给受控 Controller fixture 注入实际新 helper，未改变行为断言，`07-scope-followup-green.tap` 仍31/31。06记录此前 fixture 未注入新依赖的失败，不是新的功能 RED。被审文件及独立测试初始 hash 见 `freeze.json`，scope跟进 hash 见 `freeze-scope-followup.json`。

## 明确未完成的验收

本轮不证明原生菜单的实际事件顺序、系统剪贴板权限、Chromium contenteditable 撤销堆栈，或 typed mention 在菜单粘贴时与原 Web paste handler 的芯片水合完全一致。代码的菜单 paste 经受控文本读取再 `insertText`，原 Web onPaste 用 `insertDraftAtCaret`；应在真实 Electron 追加“复制引用芯片→菜单/自定义粘贴→视觉芯片与发送序列→撤销”场景，不能用本轮纯文本 fixture 抵扣。父代理正在进行的原生测试归其单独证据记录。

全局 Escape 与 Monaco 原生互斥动作的具体上下文由后续 Monaco 独立审核和真实编辑器场景验证；本轮没有审自己的适配实现，也没有把全部 runtime action 宣称为已逐项执行。
