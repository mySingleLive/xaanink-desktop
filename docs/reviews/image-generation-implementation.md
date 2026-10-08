# 文生图实际协议实现交接

日期：2026-10-08；作者：product_revision_review。结论：实现与TDD证据已准备交叉审核，作者不授予独立PASS。

原generateImageBuffer只有OpenAI兼容请求，返回URL时又在worker直接fetch；桌面worker的联网禁令会使有效生成结果无法存入作品。现在原业务入口发语义IMAGE请求，由main读取精确已保存模型与授权版本，执行对应供应商协议，验证单图回执并下载/解码真实字节，worker收到64KiB帧后沿用原本地作品资产与版本服务。

## 改动与接线

- 新模块：desktop/main/image-generation.ts、image-provider-protocols.ts；desktop/core/image-resource.ts；desktop/shared/image-generation.ts。
- 原模块窄改：ModelGateway增加原IMAGE响应证书/短期一次资源授权；ModelService增加严格startImage，保留原text路径；desktop/service/models.ts增加generateLocalImage；src/lib/ai/image.ts替换旧网络实现，保留withLongTask与原资产入口。
- root已在main/index.ts接model.image.start→modelService.startImage(value)。worker沿用现有configureModelTransport；无需另改service/index.ts。作者未修改main/index.ts、Workspaces、资产锁/数据库、备份或UI。
- undici7.30.0已由root提升为直接运行时依赖（原锁定相同版本）；不依赖隐式transitive包。sharp为原项目直接依赖。

## 协议与边界

详见[合同](../evidence/implementation-14/image-generation-contract.md)及[来源登记](../evidence/implementation-14/image-generation-provider-sources.json)。所有实际HTTP在main，每次发送和读取复核lease/modelId/authRevision/IMAGE/endpoint；下载从已解析API回执字段取得精确URL，grant不接受worker传入的URL。外部HTTPS使用公共地址校验和固定DNS，下载无Key/Cookie、不跟重定向、10MiB/30秒；仅custom同已授权origin允许明确自托管网络范围。HTTP200业务错误、task id不符、错误计数、旧URL、损坏图片、HTML/SVG与多图都不能保存。

原prompt不裁剪、不加第二个文本模型调用、不做收费生成重试。已确证字符上限发送前拒绝；未知token上限交供应商验证。取消/版本撤销阻止迟到输出和后续GET；业务槽及时释放，生产fetch接受AbortSignal，但不声称JS密钥字符串能安全擦除或服务商已接收任务免费撤回。

当前覆盖八家IMAGE预设和custom OpenAI兼容端点。阿里8个仅编辑型号、未核验未来原生协议型号和custom Anthropic图像请求明确unsupported，不能把它们当成功。目录发现/连接测试属于已独审43的另一模块，本次未改变其旧冻结源码或宣称目录更完整。

## TDD证据与实际验证

所有原始RED/失败尝试保留在implementation-14。主要真实RED：初始核心4FAIL（01）；资源6FAIL（03）；URL未实现（06）；语义start3FAIL（08）；原业务入口1FAIL（10）；供应商30未支持FAIL（12）；Wan尺寸（15）；下载未含超时（20）；损坏像素/仓库resolve超时（22）；Vidu/WAND规格及data.error（24）；双重percent编码Key（28）；原prompt服务端截断风险（32）。对应修复后GREEN均单列，不改旧日志。

04-green-attempt中的2项是Buffer/Uint8Array原型oracle差异；13-green-attempt中的1项是旧Wan夹具错误使用choices而非官方results；14/27类型失败为作者测试类型；18尝试含sandbox loopback禁止与错误cleanup，19/20才是有效超时RED。17/27还包含其它作者在途类型错误，未将它们算本模块产品缺陷。最终计数以最终运行日志为准，不累加历史同例。

测试包含五个新文件：image-generation（8）、image-resource（12）、model-image-service（4）、image-provider-generation（40）、local-image-generation（1），65个顶层Node用例；加旧model-authorization（9）、model-service（3）、local-model-generation（1）共78。真实FS/ModelRepository、真实PGlite全迁移/作品资产、真实undici loopback用于指定场景；供应商和外部DNS/CDN响应仍是受控mock。

v2保留v1清单与RED：独立review80发现IG80-01在sharp解码等待期间总超时不能释放业务槽，修复image-generation的各解码/验证等待和ModelService最终等待，统一race取消/授权lease；迟到底层解码结果不可读。IG80-05/06按官方参数补腾讯Seedream两ID600代码点，以及万相七个准确型号的2100/2000/500/800边界，超限零POST、边界原文单次POST。三项原独立RED保留；IG80-02/03/04取消关闭、迟到异步POST、worker收帧换Key是在修后首次GREEN，不能称先RED。独立文件含6个顶层用例，与65作者+13旧回归合并为84；作者仍不授予独立PASS。

复验命令：Node24 --import tsx --test --test-reporter=tap 上述五新文件加三旧文件和独立image-generation-80-review.test.ts；其中真实127.0.0.1监听在当前sandbox需已获自动批准的隔离HTTP执行。全量类型检查为Node24 node_modules/typescript/bin/tsc --noEmit。准确最终日志/退出码/SHA见image-generation-frozen.json。

没有调用真实Key/付费接口、没有启动可见Electron，没有把mock协议通过改成真实App、原生OS、Windows或531顶层用例验收。冻结后交非作者独立审核，必要修复保留v1清单与原始RED。
