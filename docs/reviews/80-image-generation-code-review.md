# 80 · 本地文生图网关与供应商适配独立审核

日期：2026-10-08。审核者：ui_revision_review。作者：product_revision_review；main 的语义 RPC 分支由主代理接入。审核者只增加独立行为测试、来源核对与证据，不修改生产实现，不运行 Electron，不调用真实模型或系统剪贴板。

## 结论与范围

**限定 PASS。** 三处独立真实失败已修复。新增6项行为检查与78项相关回归合跑84/84，fail/cancelled/skipped/todo均0、exit0；仅测试夹具作 Buffer→Uint8Array 的类型收窄后，6项再次全部通过。14个源/测试入口及传递 imports 的最终类型检查 exit0、空诊断。531条正式用例仍为 not-run。

范围为 main 的语义 `model.image.start`、授权图片响应凭证/一次资源 grant、图片资源安全读取与解码、八家供应商与自定义 OpenAI 兼容协议的已核验 IMAGE 调用、worker 的受限二进制收集，以及原 `resolveImageModel → generateImageBuffer → saveWorkImage` 入口适配。main/index 的相邻备份/恢复、Workspaces 其他功能、完整业务 UI、实时目录完整性及账户权限不据此批准；这些只读依赖为接线快照，不要求相邻开发保持整文件旧指纹。

作者最终 [image-generation-frozen.json](../evidence/implementation-14/image-generation-frozen.json) version2 只读核验：17份作者源码/测试/合同、1份独立测试、46份证据及19份只读依赖快照全部 SHA256 匹配。main 语义 RPC 行保持一致；其单独 wiring 整文件快照在初次核验匹配，随后主代理相邻恢复接线继续改动，独立清单分别记录旧/当前 main 指纹，不作为本批图像源漂移。按文件原顺序依次连接17份作者及1份独立测试的 `path:sha256`、LF含最终LF重算，aggregate为 `bae320d64ecf2f80d835b3f9a5b0a89f5d9cb3f472a97bf6b79a6c94fe8a63ff`，与记录一致。初始v1清单保留，当前只读匹配不意味着批准相邻恢复源码或要求其停止开发。

## 独立发现与修复

| 问题 | 实际失败 | 修复及相同断言复验 |
| --- | --- | --- |
| IG80-01：解码没有受总时限约束 | 使用实际 ModelRepository/ModelService/ModelGateway 和有效 PNG，仅保持 sharp 的像素解码 Promise 不完成。推进180秒后调用仍 pending，active slot 未释放。`review80-decode-deadline-red.tap` 为1 FAIL/exit1。 | 每个 base64/URL 解码 await 均与组合 signal 竞速，service 外层也受 controller/lease signal 约束。总时限到达即 IMAGE_TIMEOUT、slot 清除、不可读取迟到图片。已提交到底层的原生解码工作可能继续结束，测试只证明 API 及时拒绝与迟到结果隔离，不声称中断原生 CPU 工作。 |
| IG80-05：腾讯 Seedream 缺硬字符上限 | 两个确切型号中首个601字提示词正常提交并返回图片，未按600字官方限制提前拒绝。`review80-tencent-prompt-red.tap` 为1 FAIL/exit1。 | 两 ID 在 POST 前按代码点检查；601拒绝且零 POST，600原文完整一次提交，实际 PNG 解码通过。限制依据 [腾讯 Seedream 文档](https://intl.cloud.tencent.com/zh/document/product/1300/83710)。 |
| IG80-06：万相 T2I 缺逐型号字符上限 | wan2.6-t2i 的2101字仍正常提交并下载图片；官方会截断，违反完整提示词合同。`review80-wan-prompt-red.tap` 为1 FAIL/exit1。首个失败即停止该测试，没有伪称修前七型号均被实测。 | 为7个确切 ID 增加2100/2000/500/800对应限制。最终逐 ID 验证超限零 POST/下载，边界长度原文一次提交；不裁剪、不重试付费 POST。型号限制来自 [万相 T2I API](https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference)。 |

三份 RED 为审核者实际执行的产品失败，原记录未覆盖。IG80-02/03/04 首次执行在解码修复之后即 GREEN，是独立补充验证，不称六项全都捕获了 RED。最终类型检查前一次 TS2345 来自新增测试的 `new Response(Buffer)` 类型，保留 `review80-scoped-typecheck-fixture-attempt.txt`；只收窄夹具为 `Uint8Array.from`，未改变行为断言或产品代码。

## 独立行为验证

新增 `tests/unit/image-generation-80-review.test.ts`，6项：

- IG80-01：总时限包括正在等待的真实图片解码，超时及时清 transfer，不输出迟到图片。
- IG80-02：解码未完成时 service.close 及时取消与清 slot，后来的像素结果不能被读取。
- IG80-03：一次异步生成 POST 的响应头故意忽略取消，取消后即使晚到有效任务 ID，也不得轮询或下载；POST总数1。
- IG80-04：真实仓库持久 Key 轮换发生在两个64KiB IPC帧之间，实际 worker 收集拒绝 AUTHORIZATION_REVOKED，未落任何部分图片文件，transfer清理。
- IG80-05：腾讯两 Seedream 型号逐一验证600字边界与超限零请求，图片使用实际 sharp 解码。
- IG80-06：七万相 T2I 型号逐一验证官方字符边界，同步/异步请求及实际 resource receipt 路径执行，提示词不变；供应商/CDN/DNS响应为替身。

仓库、实际 Promise 生命周期、流式帧、PNG解码及上述独立临时文件操作真实执行；vault保护、供应商HTTP/DNS、时钟和特意延迟的 decoder 方法受控。没有把这些替身称为真实 safeStorage、外部网络、供应商生成或系统退出验收。

相关回归包括授权9项、既有模型服务3项、原 SDK 文本路径/PGlite1项，以及本批作者图像65项。真实 undici 测试只到隔离 loopback，核对无 Key/Cookie；原图像业务测试运行实际 PGlite/Workspaces/本地资产，并把 worker fetch 改为禁止，证明原图片入口经 main 获取有效字节后复用原资产保存。供应商/API/CDN响应仍是 mock，单个用例内部的多步骤和多型号不重复计作顶层测试。

## 源码与协议判断

main 从已保存模型读取权威 ID、IMAGE 类别、启用与精确授权版本。worker 不提交任意 endpoint、provider、资源URL、Key或 headers；每次实际请求、轮询和资源读取沿同一 lease 复核。API 响应在 main 持有原 Response receipt，资源 grant 绑定 lease/endpoint/精确URL且一次消费；renderer/worker不能伪造该 WeakMap 凭证。外部资源只允许 HTTPS、无凭据 GET、拒绝重定向，DNS地址全部核验并固定到实际 undici连接；自托管例外仅原明确授权 origin，不扩展其他 origin。

读取、JSON/base64、图片及 IPC 帧各有明确上限；sharp 验证实际像素，拒绝损坏、SVG/HTML、过大、多页、错误数量或失败任务携带的旧图片。上游 message/URL不作为错误文案回传；资源URL检查原 Key 及限定层数的 percent 编码，不声称识别任意编码或消除所有恶意上游内容。下载 grant/响应 reader/临时流在取消与撤销路径结束，worker `finally` 请求取消，部分帧不会交给资产服务保存。

一次调用只发一次生成 POST；异步任务按相应协议轮询，拒绝不匹配任务回执与失败状态，不自动新增生成重试。Google使用原生 Interactions，阿里及腾讯按确切型号选择已公开 native路径；其余兼容接口保留已授权 IMAGE 语义。OpenAI/xAI/custom 的协议调用不以型号前缀重新猜 IMAGE 能力；未核验未来 native型号、编辑专用型号及 custom Anthropic 图像接口提前明确失败。

原业务 withLongTask、任务快照/显式选择、取消 signal 与本地资产存储路径保留，不另造作者批准或图片版本语义。Key留 main，worker原模型引用为不可调用的无密钥记录；本轮不批准直接调用远程 Web 服务端。

独立 primary 来源检查另记 [review80-official-source-checks.json](../evidence/implementation-14/review80-official-source-checks.json)。例如 [Qwen 同步图像文档](https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference) 的 token建议和 [字节图像文档](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh) 的提示词建议，不被换算为未证实的硬字符限；Google的真实创作1K与已审连接测试512px是不同接口。个别动态页面使用 primary 索引摘录，未声称访问了登录账户或完整实时目录。

## 执行与实际边界

`review80-final-related.tap`：84/84、exit0；`review80-final-independent.tap`：最终夹具6/6、exit0，后一次仅复验同6项、不与84累加。所有 fail/cancelled/skipped/todo为0。`review80-final-scoped-typecheck.txt` 空诊断 exit0；入口、配置和命令见 `review80-typecheck-scope.json`。`git diff --check` 本轮受审源/独立测试通过。

作者既有78项及新修复日志单独保留；不会把作者历史 RED、39/43旧审核或浏览器原型检查当本轮独立新增。作者另有本版全量类型检查 `image-generation-40-final-review-typecheck.txt` exit0空诊断，与本次独立 scoped检查分开注明。此结论不包含真实 Key 计费调用、供应商账户可用性、系统原生窗口/剪贴板/文件选择、Windows、完整图片业务场景或全部正式桌面验收。取消只阻止迟到结果继续保存，不能承诺供应商撤销已发生的计费。当前无范围内剩余阻断。

最终指纹、命令、统计及只读依赖边界记入 [review80-independent-summary.json](../evidence/implementation-14/review80-independent-summary.json)；该文件不自包含自身 SHA。
