# 聊天默认模型客户端接线独立代码审核

日期：2026-10-07。审核者：`/root/product_revision_review`，未编写本批默认选择接线。范围为 `chat-defaults.ts`、`image-model-selection.ts`、聊天store/session、`use-agent-chat.ts`、`ModelPicker.tsx`、`DesktopApp.tsx`、`ModelRequiredDialog.tsx`、`model-guidance.ts` 与主进程 `model.resolve` 通知接线。四个图像面板仅核对默认选择/标签/Logo映射；原业务迁移由另一个独立代理审核。

**最终结论：限定代码审核通过。CD44-01～03已修复；独立6文件22/22通过，全项目TypeScript exit0。** 本记录不宣称真实桌面、付费供应商或正式顶层验收通过。

## CD44-01 · P1 · 模型选择迟到失败污染当前会话/后续选择

首审 `ModelPicker.applyChoice` 乐观改store，PATCH失败无条件 `setModelChoice(prev)`。会话A选择第二模型但请求挂起，切换B并加载其已保存模型，A迟到409会把B选择回滚到A旧模型。同会话连续两次选择，第二次已成功，第一次迟到失败也会回滚到最初模型。错误回滚还会把显式选择标记写入新的会话/草稿。

独立 `tests/unit/chat-selection-review.test.ts` 转译原组件并执行真实onClick/applyChoice闭包，以受控hooks、store、HTTP完成顺序复现；未复制选择算法。`client-selection-review-red.tap` 两项均因实际选择值不符失败：`saved-b → old-a`、`model-3 → old-a`。建议绑定account/conversation/draft和选择版本，仅当前所有者可回滚或记忆；持久化写入按顺序执行，避免UI最新选择与服务器最后落库不一致。

## CD44-02 · P2 · 重试状态读取完成后未核对会话归属

`retryTurn` 在await `reconcile(turnId)` 前后未绑定当前会话/草稿。读取A回合的期间切换B，`applyTurnState`虽会忽略A的迟到状态，`retryTurn`仍取此时B的draftNovelId并调用send，发出 `{conversationId:B, novelId:B, retryOfTurnId:A}`，同时进入B的生成/恢复状态。服务端是否拒绝此矛盾请求由业务边界决定；本审核不推断它会实际调用模型或写错数据库。

独立 `tests/unit/chat-hook-review.test.ts` 直接执行原hook中的reconcile/retryTurn/send，使用真实 `ChatExecutionController` 与受控HTTP gate。有效 `client-hook-review-red.tap` 第一项观察到上述不应发送的POST。建议重试捕获account/conversation/draft和执行代际，await后同时验证归属、返回turn的conversation和当前恢复状态；切换/重置后应退出，不操作新会话。

## CD44-03 · P1 · 迟到已受理JSON响应恢复被取消的会话

send在fetch后有 `execution.owns(token)`，但application/json分支的 `await res.json()` 后缺少第二次核对。响应body读取期间reset或切换新草稿，JSON迟到完成仍应用defaults、强制设置旧conversationId与旧作品，再删除/合并消息。SSE路径每个事件已有owns检查，JSON路径边界不一致。

同一独立hook测试第二项在JSON gate期间reset到作品B的新草稿，响应到达后实际conversation变回A，得到真实RED。建议JSON解析后再次核验执行所有者，失效立即退出；错误响应的异步json读取也应遵循相同边界，不让迟到4xx清除新会话pendingRequest。

## 已核对的正确边界

- 新草稿预览settings.agent，但model/mode未显式选择时请求属性省略，由任务服务原子捕获默认快照；显式null和默认effort不会退化为“未提供”。已有conversation的null保持null，不用现时默认或首个模型修复历史；retry不发送现时override。
- session保留model/mode显式性；旧草稿仅按既有记录能证明的选择恢复。未显式的新草稿可跟随最新配置，显式失效ID保持失效，原草稿文字保留。
- 图像auto仅代表配置的默认模型。未配置、删除/禁用或显式失效选择显示对应不可用状态，不回退列表首个/最新型号；选中/default标签使用该模型供应商Logo。
- DesktopApp同时监听事件和本地保存返回的已提交内容，按models和agent变动失效聊天/图像列表缓存；pending/生成期间不直接重写草稿选择。
- 主进程只将真实 `ModelAuthorizationError` 和调用意图的text/review/image角色转换为model-required通知；selection验证或无关错误不弹首次使用引导。Dialog保留关闭/取消及去配置入口，不自动发送/重试；配置完成后由用户再次执行，现有null会话仍需在任务内显式选择。
- loadConversation在fetch与JSON读取后均检验执行所有者；accepted defaults另有选择值/显式性检查以免覆盖提交期间的下一次选择。上述正确边界不能消除本次列出的独立竞态。

## 证据范围

主代理原有 `selection-green.tap` 12项通过，覆盖纯默认转换、模型菜单基本选择、图像默认和通知分类，未覆盖上述网络完成顺序。本审核新增两份测试共4项，失败来源均为原组件/hook真实控制流；HTTP、React hooks/store视图与流渲染为隔离替身，不是浏览器或安装版验收。

初次hook harness遗漏browserSessionStorage stub，单独保留 `client-hook-review-harness-attempt.tap`；它是测试构造错误，不计入产品RED。修复harness后保存的 `client-hook-review-red.tap` 两项均为预期业务断言失败。

## 定向复审结果（已闭合）

主代理修复后独立核对：

- CD44-01：选择绑定account/conversation/draft的owner、导航epoch和选择ticket，当前值也须仍等于本次optimistic值才可回滚/记忆。PATCH串行，成功更新confirmed基线；两次失败恢复最初confirmed值，前次成功后次失败恢复前次成功值，均不回滚到未保存optimistic值。A→B→A访问产生新epoch，旧访问的迟到失败不能改新访问。
- CD44-02：reconcile和retryTurn捕获真实controller.revision与owner；retry另核对返回turn ID及conversation，使用原作品作用域。切换后立即退出，即使返回同一保存会话/草稿，也由执行代际识别旧查询。
- CD44-03：成功JSON与错误JSON每次await解析后均再检查execution.owns，失效立即退出。迟到4xx不清新草稿pendingRequest，迟到已受理JSON不恢复旧会话。提交期间明确选择下一模型/模式，accepted snapshot仍不覆盖它。

独立新增测试由最初4项扩至10项：5项实际Picker闭包、5项实际hook控制流。另合跑主代理原12项，总计22项，不累加主代理16项或历史重复日志。`client-review-independent-green.tap` 为22/22、0跳过/取消，退出码0；`client-review-independent-typecheck.txt` 为全项目tsc无诊断、退出码0。有效历史RED、harness失误日志均保留。

最终摘要 `client-review-independent-summary.json` 保存范围文件的SHA-256和证据路径。主代理继续其他菜单/main实现；该快照只界定本次审核所见代码，后续相关改动需匹配范围验证。未发现本批剩余阻断缺陷；真实桌面UI/用户操作、模型付费调用与正式顶层用例仍未在本审核验收。
