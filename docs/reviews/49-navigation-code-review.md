# 49 · 桌面导航独立审核

最终结论：本次冻结导航边界通过独立审核。NAV49-F01已修复，9项新增独立回归与原46项合跑55/55、0跳过、退出0，完整项目TypeScript检查退出0。审核者未改导航实现；原生桌面和正式业务验收仍须另行完成。

## 范围与证据

读 `navigation-frozen.json`、`navigation.md`，核对其中6份源码、5份作者测试。初审11/11文件 SHA 匹配，aggregate标识 `27131990337096aa28089b703bc2d9e390015cfb9d82a8506a8188bdea271e28`。独立实际运行原导航36项加44既有10项，`49-navigation-independent-base-green.tap` 为46/46、0跳过、退出0；这不是只接受作者日志。

新增 `tests/unit/navigation-review.test.ts`，用真实 Zustand tabs/chat store、sceneLeaveGuard、导航 history、ChatSessionRepository 与实际 use-agent-chat 函数体；控制 React lifecycle 和 HTTP/JSON返回。测试不操作运行中的Electron，不读真实作品，不发模型请求，不把受控DOM当原生验收。

## 发现

| ID | 严重程度 | 触发与可观察问题 | 最小修复建议 |
| --- | --- | --- | --- |
| NAV49-F01 | P2 | 保存过的历史会话已被删除，GET返回404。preserveOnFailure正确保住当前页/输入，但available仍只看本地sessionRepo项，持续认为缺失目标可恢复。再次Back反复访问同一404，阻住更早的有效草稿；与navigation.md承诺跳过不可恢复目标冲突。 | 当前账号/目标ID的受信404明确失效导航资格，保留本地草稿用于恢复；401/普通网络失败不永久拉黑。迟到或失去owner的404不能标记当前目标。成功显式恢复/重载时可解除失效，不能靠删本地草稿完成跳过。 |

首个独立 RED `49-navigation-independent-red.tap`：7项6通过1失败，退出1。NAV49-06执行实际hook及原repo，404后的available为true而期望false；401分支保留target，当前会话/输入/recovery保持。NAV49-08进一步把实际adapter放进真实history，验证第二次Back应进入更早草稿且缺失会话本地输入仍保留。

第二份RED `49-navigation-independent-deleted-history-red.tap`：8项6通过2失败，退出1。两项失败来自同一缺陷，不重复计算发现数量。

父代理修复以`[userId, conversationId]`标识确认缺失目标，只有执行token与来源所有者仍有效的404才记入；available排除该目标，本地ChatSessionRepository条目保留；401不记入。成功显式读取并完成JSON后的所有者核验再清除缺失标记。复核`use-agent-chat.ts`这些顺序，并追加NAV49-09验证旧所有者迟到404不失效有效目标、owned404后草稿仍在、成功显式加载后重新可导航。`49-navigation-independent-fixes-green.tap`为9/9、退出0。

最终实际命令使用Node24 `--import tsx --test --test-reporter=tap`执行作者5个navigation测试文件、44既有`chat-hook-review`/`chat-selection-review`两文件及`navigation-review`，`49-navigation-independent-final-green.tap`为55/55、0失败/取消/跳过、退出0。完整`tsc --noEmit --pretty false`的`49-navigation-independent-typecheck.txt`为空诊断、退出0。当前源码与测试12文件SHA、原11文件冻结的变化对照见`49-navigation-reviewed.json`；保留原navigation-frozen.json供初审历史追溯。

## 已独立验证的边界

- leave guard失败可观察，保持权威Tab、草稿对象与cursor；取消等待后的晚回不能激活目标，随后导航可继续。
- flush期间关闭并重建相同ID目标，旧命令拒绝该新对象；内容子视图保留。
- JSON pending时取消立即结束；旧消息、暂存提交回执、focus以及ready状态不能覆盖新owner。
- 未发送草稿保留身份、标题/幂等创建ID、显式null模型、模式、pending request和暂停队列，不发HTTP或自动重发。
- 旧HTTP完成后账号/会话/draft所有者变化，不改新owner的restoring，不toast，不发旧focus。
- 确认404后再次后退跳过缺失会话，进入更早保存草稿且不删除缺失会话的本地输入；401仍允许以后恢复。迟到404无标记副作用，显式成功重载解除缺失状态。

## 实际验证限制

独立hook夹具执行实际函数体和导航adapter effect，HTTP/JSON返回与React生命周期受控；它未挂载完整Chromium/React恢复与持久化生命周期。Tab测试使用原Zustand和真实sceneLeaveGuard，但不声称逐一实际编辑29业务面板。原生后退/前进按钮、真实键盘/菜单、布局复开、全部业务面板草稿保护仍由父代理的真实Electron验收覆盖，本报告不能抵扣这些正式场景。DesktopApp挂载及静态命令菜单是父代理拥有的额外接线，冻结清单未含这些文件。
