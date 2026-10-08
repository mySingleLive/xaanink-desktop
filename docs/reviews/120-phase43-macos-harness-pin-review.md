# 120 · 第43批macOS验收harness固定身份复核

2026-10-08。结论：**PASS_LIMITED**。当前harness只替换获准的四处字面值，完整实际包与第43批冻结身份一致，未发现本轮范围内的阻断。主代理可在既有授权范围内继续新的CUA原生验收；本结论不表示系统首菜单已经显示玄印，也不表示新的App已启动或正常退出。

审核只读仓库中的脚本、冻结记录、构建日志及release产物，新增本报告和两份派生读回记录。未改harness、生产源码、原oracle、旧报告或冻结；未启动App/Electron、PG、CUA，未访问HOME现存目录。没有扩展源码审核、TDD或创建新fixture。第117批harness审核及第119批本地化代码审核各保留原结论，本120只核本轮固定身份与字节差异。

旧117原件 `docs/evidence/implementation-43/phase42-117-harness-original.mjs` 为22,469字节，SHA256 `10a2bab10b9b1d66ce22610a8e1effe2569c65097df63a6846ae1cc6eaa55059`，与既有117身份相符。当前 `scripts/acceptance-packaged-macos.mjs` 仍为22,469字节，SHA256 `f4889d677ec3e8b05da0859a7ee558c7b7a4faee6db7a3ac86987e8f29482ad4`。独立比较对每个旧字面值强制出现次数为1，只执行以下替换，再要求整个当前UTF8字节数组等于预期数组；比较通过。Node24 `--check` 退出0、无stdout/stderr，未执行该脚本。

| 唯一替换位置 | 原117 | 当前43 |
| --- | --- | --- |
| native证据目录 | `docs/evidence/implementation-42/native` | `docs/evidence/implementation-43/native` |
| freeze路径 | `docs/evidence/implementation-42/packaging-frozen-v1.json` | `docs/evidence/implementation-43/packaging-frozen-v1.json` |
| 固定freeze SHA | `d2c4eb91b6183de41b3a5bbe811c99018260d907c50526007632f9d01835a968` | `3e0fc12669dda2c0a6b3a88084d7f862145cb91ebd9bb5e7288f49b6812adc3a` |
| scope中的阶段名 | `Actual frozen phase42 packaged macOS app` | `Actual frozen phase43 packaged macOS app` |

其余所有字节相同。因此既有117的实际启动方式、参数限制、完整包校验、测试数据确认、冷锁/audit只读oracle、普通工作台观察、退出/600秒watchdog、错误与证据保存逻辑均未由本增量更改。历史脚本原件仅用于字节比较，未从其归档位置执行。旧42运行结果不能自动认证43运行结果；更换pin只使下一次运行核对新的43冻结身份。

第43批 `packaging-frozen-v1.json` 实际SHA为 `3e0fc12669dda2c0a6b3a88084d7f862145cb91ebd9bb5e7288f49b6812adc3a`，schemaVersion3、版本0.1.0、arm64。复核19项固定输入/产物，包含freeze本身、两个harness版本、旧baseline/42freeze、119最终报告、六项43输入、两项42新增生产输入与五项最终产物；每项实际字节数/SHA匹配，检查末尾再次读回全部19项，无变化。119最终报告SHA `927dcb3afa15ace71372d8c9e9e5d14befc24c6e233da228a5a5a1b13b0f2357`。本轮没有重新执行662项业务源码审核或资源依赖PG probe。

| 冻结产物 | 字节数 | 实际SHA256 |
| --- | ---: | --- |
| DMG | 335,466,130 | `b868dc9ca1bdd632fc3f708e8b9b3f8429914a1662ab544218bc704b9e4b3efa` |
| ZIP | 350,091,695 | `761960e1f521952ea0ea7a0f8732ca19707677be54a43dc436bfda5d289cb544` |
| DMG blockmap | 349,861 | `531773e036b8e654ae5ca19e902be3b19352b6f781db231e1bb63f55b2d9c675` |
| ZIP blockmap | 346,672 | `05d48ea758f829ec94464d7756c6e3259c22bb55abf91e6738504b7d3e758b17` |
| `release/package-static-darwin-arm64.json` | 6,072,123 | `9b0fc169a6bf23f15a76d18563c92a3c3b1ee162615437ef09b278182db0e0fb` |

完整实际 `release/mac-arm64/玄印写作.app` 为canonical非链接目录，文件表27,011条、26,997个普通文件、14条符号链接、3,739个目录。独立遍历不跟随目录链接，拒绝未知文件类型及不安全/重复manifest路径；每个普通文件用nofollow打开，逐字节计算SHA并核尺寸、打开前后文件版本，每条链接核实际解析目标位于App内且等于manifest。共读取1,036,043,980个普通文件字节，无路径缺失/额外项、尺寸或SHA差异；末尾再次核目录身份和完整文件路径集合。规范化预期/实际文件表SHA均为 `757daa3f169c2a5cf1e18da14b5d87bf919ee7e1b458a3a06d8afb9510e333c0`。这是本审核实际全量文件读回，未仅依据作者日志推定。

实际系统 `plutil` 只读主App Info.plist，确认bundleId为 `ink.xuanxiang.desktop`，raw CFBundleName、DisplayName、Executable均为玄印写作，版本字段均为0.1.0。两个实际主Resources语言文件 `en.lproj/InfoPlist.strings` 与 `zh_CN.lproj/InfoPlist.strings` 各27字节，精确为 `"CFBundleName" = "玄印";` 加换行，SHA均为 `446d3ebeb26d81cad90edeed196ab087cb21df3ffce8537aa49d1cdd8485848f`。这些静态内容与freeze/manifest的locales2、menuName玄印、runtimeName玄印写作相符；文件存在不能证明系统菜单已经采用该本地化值。

只读核对作者实际 `package-02.log` 的after-pack资源通过、PGlite closed与最终packaged阶段；manifest记314项项目资源、44个probe模块、exitCode0、forcedTermination=false、pgliteClosed=true。`packaged-resources-01.tap` 明确10/10、fail0，含实际ZIP CRC/文件表与资源/负向测试；`dmg-verify-01.log` 明确VALID。上述执行归属作者，本120没有重跑PG、ZIP测试或hdiutil。`package-01.log` 原实际缺locale构建失败及119-N05原RED仍保留，已记录SHA；不能将package-02成功回写为package-01成功，也不能将119的14/14隔离结果称为本120新测试。

独立读回在2026-10-08 11:44:22–11:44:35 UTC执行，Node退出0。派生记录 `docs/evidence/implementation-43/review120-01-pin-package-readback.json` 为8,228字节，SHA `9bf798307fade1607c92cb2b412bd17d5c01cb726ab5ef472553f72809476d96`；其中保存19项输入/产物、六份历史/当前日志指纹、四处精确替换及完整实际文件表统计。最终另读回这些身份与本报告，见同目录 `review120-02-final-readback.json`。

本轮有限PASS仅解除“旧pin与新实际产物身份不符”的启动前阻断。原生首菜单、关于窗口、Renderer/Helper真实启动、正常持久化/重开/退出及后续CUA均待实际新PID验证；未授签名、公证、Windows、供应商或模型调用、完整530项正式验收PASS。freeze中的530仍为not-run、Windows为pending，现存默认测试数据环境没有被本审核读取、清理或重新判定为fresh-only。
