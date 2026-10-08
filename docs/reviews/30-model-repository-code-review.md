# 主进程模型仓库独立代码审核

日期：2026-10-07（Asia/Shanghai）。审核者：独立子代理。范围为 `desktop/main/model-repository.ts`、`desktop/core/settings.ts`、`tests/unit/model-repository.test.ts` 及其提交语义依赖 `versioned-store.ts`；已审核网关只核对导出的端点验证器复用。未改实现、未控制浏览器、未启动真实HTTP或全站测试。

## 当前结论

**通过本批主进程模型仓库代码审核：MR-01–03已闭合，无当前范围内的剩余阻断。** 子代理独立执行最终8项隔离单测全部通过，并用真实临时文件复核兼容型号切换、空Key保留、能力编辑重开和保护可用性异常。safeStorage当前仅可控SecretProtection替身，不能宣称Electron系统保护、IPC或正式DESK用例通过。

## 已确认正确的边界

- 模型保存先经严格schema与端点验证，采用版本冲突校验、同卷原子替换后发布授权；失败前置写入不发布新授权。rename后目录同步失败带committed标志，并重新读取权威文件发布实际授权。
- 公开模型去除encryptedKey，并统一返回固定八个圆点的掩码；新写入的keyMask也固定。磁盘仅保存保护接口生成的密文；keyFor仅接受存在、启用且版本匹配的模型。保护不可用拒绝保存和读取密钥；保护接口的检测/加密/解密异常均转换为固定文案，不带原始cause。
- 空Key只在既有模型且provider/protocol/endpoint/kind授权范围一致时保留密文；Key/范围/启用状态/型号变化递增授权版本。保留Key的名称编辑不递增版本。
- 删除模型与三类默认引用置空在同一AppState提交内完成，没有自动补位；停用保留同ID引用。版本冲突由VersionedStore拒绝，不能用过期revision覆盖其他变更。
- 思考能力变更与默认设置更新在main权威保存边界处理：兼容档保留，不兼容型号/能力变更存default；相同默认模型的显式不支持档位拒绝。default是持久化的“采用模型默认”标识，不能改写成元数据声明的low等档位。删除默认文本模型同时重置思考为default。

## 已修复问题与复审

| 编号 | 修复前实际问题 | 修复与最终验证 |
| --- | --- | --- |
| MR-01 | 接受1–4字符Key，keyMask拼接slice(-4)，公开状态包含完整短Key。公开假Key `abc` 实测completeKeyAppears=true。 | 保存与公开输出均固定八圆点掩码，旧存储的keyMask也不原样输出。1–4字符Key回归通过，无完整短Key公开。 |
| MR-02 | 默认文本A的high切到只支持low的B仍保存high；显式任意档位也接受。 | 型号不兼容时存default，显式非法档位/不自洽的模型默认元数据拒绝，当前默认型号能力变化同步回default。单测覆盖不兼容切换、非法设置与元数据，新增持久组合用例确认A→另一兼容C保留high、C移除high后重开仍default；独立真实文件探针也通过。默认引用不补位。 |
| MR-03 | 保护接口异常原样传播，替身异常可含完整输入Key。 | 检测/加密/解密接口分别转换为固定安全文案，无原始cause；加解密失败回归通过，加密失败revision仍0。独立确认isEncryptionAvailable自身抛含Key异常时save/keyFor均脱敏。 |

## 测试证据与覆盖

Node24.18.0执行 `node --import tsx --test tests/unit/model-repository.test.ts`。原3项通过后独立发现上述问题；修复及持久组合用例补齐后8/8通过，0失败/取消/跳过。model-repository-red.tap与green.tap分别记录初始3失败和3通过；model-repository-review-red.tap是扩充后的7项，4通过/3失败，包含掩码、思考及错误脱敏的真实RED。主代理core-latest.tap记录核心合并51/51，其中模型仓库8/8；子代理已只读核对该记录，并独立复跑仓库8项，没有将其扩称为独立执行全部51项。测试编号仅是追踪，不等于正式验收通过。

“persist before publishing”初始测试的diskRevision来自传入authRevision，已改为发布回调同步readFileSync读取真实磁盘值并逐项比较；不能用镜像断言替代落盘证据。新增单测还覆盖rename后sync失败committed=true的授权对账、新旧keyFor版本、删除在rename前失败时默认引用/旧Key保留，以及删除成功后重开。

追加独立持久探针确认：同scope留空改名称/能力时cipher与authRevision保留，fresh repository读原Key正确；A(high)→兼容C保留high，C移除high后重开仍default；provider/protocol/endpoint/kind分别变化且Key留空均拒绝，revision保持。这些场景现已纳入新增可重复组合单测，重开后按原授权版本keyFor成功且密文不变，四种跨scope拒绝后文件字节和发布事件均不变；子代理独立复跑通过。此轮仅补测试和审核记录，实现没有再次改动。

所有追加场景直接导入实际类，使用临时独立目录及公开假Key，执行后清理；未使用真实用户密钥或目录。后续真实safeStorage、main IPC脱敏、任务授权联动及两平台验收须另行执行，不能沿用替身证明系统加密。
