# 模型授权最终 HTTP 网关独立代码审核

日期：2026-10-07（Asia/Shanghai）。审核者：独立子代理。范围仅 `desktop/core/model-authorization.ts` 与 `tests/unit/model-authorization.test.ts`，以及 implementation-01 中本批RED/GREEN记录。未审核刚导入的其他Web源码，未修改实现或运行全站；只修改本记录。

## 当前结论

**通过本批核心网关代码审核：MG-01–03已修复，无当前范围内的剩余阻断。** 子代理独立执行最终9项隔离单元测试全部通过，并复核授权撤销、外部取消、流清理、协议认证及合法重定向的内存场景。网关尚未接入main/worker/SDK或真实safeStorage，本次不能将任何正式顶层验收用例标passed，也不是实际桌面App或真实模型验收。

## 已确认的边界

- lease绑定模型ID、授权版本、类别及不可伪造的活动对象身份；授权记录先变更/删除再abort旧lease。相同版本不可替换不同记录，删除后版本不可倒退；未保存草稿不调用replace，旧授权保持。
- 异步keyFor返回后再次核验，在每个最终fetch及手动redirect发送前同步核验；只允许原origin及路径前缀，禁URL账号/密码、非回环HTTP、hash、常见敏感查询参数及普通路径越界。输入的常见认证/cookie/host headers被清除，按协议由主进程取Key重新生成认证头，禁止自动redirect/携带cookie。
- 流每次reader.read前后检查授权，并监听合并signal；finish/remove/新授权版本及调用者AbortSignal会主动error外层、丢弃已缓存chunk并cancel底层。EOF、底层错误、授权撤销和消费取消均移除监听并释放reader锁。lease终结由调用者finish完成，不能将每次fetch结束视为整个任务结束。
- main拥有网关与safeStorage、worker经IPC请求网关的部署边界正确；当前仅核心类，不代表全部SDK重试/发现/图像或资源下载已接入该出口。

## 已修复问题与复审

| 编号 | 修复前实际问题 | 最终修复与验证 |
| --- | --- | --- |
| MG-01 | 仅在pull/read返回时核验，导致撤销后永久挂起读取不结束、source.cancel=0，预取chunk仍交付。首次修复后的追加探针又发现cancel完成后底层锁仍true，只有正常EOF释放锁。 | 合并signal的abort监听主动清外层队列并取消底层；共享cancelReader/finally releaseReader及一次性释放守卫覆盖所有结束路径。新增挂起/预取及锁释放测试通过。独立探针还确认新revision、外部Abort及EOF的取消/释放，均无迟到交付；锁释放问题已闭合。 |
| MG-02 | 敏感query未被拒绝，公开假Key的`?key=fixture-stale`仍发送一次；base也可注册此类参数。 | 注册、请求、redirect统一校验参数名，解码后不区分大小写并规范连字符/下划线，拒绝Key/token/secret/auth及签名凭据等常见名称。测试覆盖api_key/AccessToken/编码key；独立确认非法base和编码api-key在取Key前拒绝，普通api-version query与同端点307仍成功。 |
| MG-03 | 仅TEXT配置时，空IMAGE选择错误显示“未选择”。 | 按请求kind判断是否存在该类记录；空库、TEXT-only→IMAGE测试通过，独立复核IMAGE-only→TEXT及IMAGE未选择。停用/不存在/类别错误仍阻止begin，不静默补位。 |

## 子代理执行记录

使用Node24.18.0执行 `node --import tsx --test tests/unit/model-authorization.test.ts`。原6项通过后，独立发现上述缺陷；最终源对应9项全部通过（0失败/取消/跳过）。初次tsx CLI试跑因sandbox不允许其临时IPC pipe返回EPERM；改用Node import入口后正常执行，这是测试启动环境限制，不是App失败，也没有申请扩大权限。

所有追加探针直接导入实际类，使用公开假Key和内存Response/ReadableStream；未启动HTTP、修改浏览器或写用户数据。修复前四个场景分别发现挂起读取、缓冲交付、敏感query和类别诊断失败；首次修复后又实测五种取消路径仍持锁。最终单元测试覆盖remove/finish/消费cancel/底层error释放，子代理补查新revision/外部Abort/正常EOF，均locked=false；撤销路径source.cancel=1且读取拒绝。

还独立验证OpenAI/Anthropic/Google三协议只重建其对应的当前认证头，清除其他协议旧Key、cookie、host和proxy-auth，保留正常Content-Type；同revision改变enabled被拒且现有lease保持，删除后的旧revision不能重新注册，增加revision可恢复。

已有authorization-red.tap的6项失败是Missing expected exception/rejection等真实行为缺失，非依赖或语法错误，authorization-green.tap对应原6项通过。model-authorization-review-red.tap为扩充后的8项，3通过/5失败；review-fixes-green.tap中的8项网关检查通过。第9项锁释放由子代理修复前真实内存探针发现，最终新增测试独立复跑通过，不将先前8项RED冒称已覆盖该路径。

测试名中的DESK/NET编号是追踪链接，不是正式顶层用例执行结果。当前“失败草稿未发布”测试只证明调用者不调用replace时旧lease仍有效，没有实际磁盘事务或main集成，不能扩称真实保存失败/SDK/网络已经验收。

## 后续条件

调用链正式接入时还需验证所有SDK发现/生成/重试确实经main网关、main安全IPC与大小限制/响应流背压、vault安全存取、未保存模型的独立测试授权、调用者finish的finally路径与外域资源无凭据下载。这些是后续接入验收条件，不改变本批核心类审核通过结论。正式DESK/NET/LIVE状态保持未执行，真实平台/供应商验收依用例另证。
