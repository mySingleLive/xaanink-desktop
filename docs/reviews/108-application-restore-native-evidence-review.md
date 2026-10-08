# 第36批真实 macOS 恢复运行证据独立审核 108

审核者 `/root/application_restore_review`；2026-10-08。**用户已取消备份功能；本审核范围撤销，未完成且不授运行通过结论。** 实际PG/Electron资源由运行作者独占，审核者只读脚本、输入和输出，不启动新引擎、不修改生产或作者oracle。107源码限定PASS保持原范围。

## 初始脚本和观察链核查

准备v1与01保留的实际used-script均为SHA256 `c00375b8d553c93ba866c92f3d5c18dc8a021e7d45c83061e24df5b417675e89`。准备日志只做script/generated shim语法检查，不能代表真实私有proof、PG或原生流程通过。旧01/04语法错误保留。

新尝试通过实际Electron CLI `-r <isolated observer> <actual project>`加载观察shim。真实Worker子类调用OriginalWorker构造，只追加本观察脚本到execArgv，workerData/RPC payload不变；PGlite.create与engine.close调用原函数并返回原值/Promise；IPC wrapper注册并调用原callback、返回原Promise，另挂只读完成观察。shim写入独立证据目录，不修改pointer、request、receipt、journal、SQL或供应商结果。生产所有直接PGlite创建点使用同一个PGlite.create及canonical目录；需要最终trace中实际首进程源engine开/闭事件佐证shim确实覆盖引擎，再核冷进程opens0。

## 尝试01及加载机制修正

01实际完成isolated原schema seed，并启动真实Electron PID92377，但随后原`controls()`的“shim已安装”guard拒绝。实际installed `node_modules/playwright-core/lib/coreBundle.js:44285`在spawn之前执行`delete env.NODE_OPTIONS`；其自己的loader使用CLI `-r`。01的operationId/target为null、checks为空，尚无备份、选择、恢复intent或激活动作；teardown记录PID92377 alive=false。01所有fixture、failure JSON、runner/native日志、used-script和截图保留。此为观察加载机制失败，不称恢复产品RED或native通过。

02实际使用脚本SHA256 `8e8b851565d0749e395905cfc2d2e0604ac25d7a3868752ffa38168d80405ca9`。`review108-01-preparation-delta-check.json`独立反向归一化证明，相对于01仅改三处：CLI `-r`而不依赖NODE_OPTIONS、每PID实际`app.getAppPath()===project`断言、process记录追加真实appPath；其余全部observer及oracle字节一致。没有改main entry、伪造项目路径、stub真实返回值或削弱任一恢复检查。02使用新的evidence目录，01未覆写。

`review108-02-source-107-precheck.json`再次核验107 v1/v2共175项，changed0，聚合SHA256仍为`15b0b81e1414b86c406a3f1a84a0616442363f9c820802e67dca570d9dab6a86`。

## 尝试02的实际证据及待修正harness边界

02 shim确实加载：真实原工作台PID94157具有实际project appPath，trace44条，包括source inbox/work两实际engine open及close、backup staging/validation两个实际engine open及close、ordinary worker实际退出。原settings关闭restoreSession、应用与一部作品的实际原schemaPG备份、旧备份中的第一输入与之后最新未提交输入已完成。02并未完成恢复；operationId/target仍为null。

02停在原恢复对话框中`恢复此应用备份`按钮count默认5秒等待：独立亲看failure-window，实际应用/作品列表都仍显示“正在读取…”，不能把这个截图认定为已加载空列表或永久缺按钮。必须先等待真正列表receipt/加载完成，仍保留exact1按钮和Cancel零intent全部oracle；不得直接走桥接绕过真实按钮。旧02的所有日志/fixture保留。

另发现最终oracle把所有model-rpc均要求0，02实际10条均为`model.defaults`，发生在普通工作台正常加载，只读本地默认配置，不是模型执行或旧审批重放。此精确误判已向root报告；root随后明确授权harness仅允许本地只读model.defaults，继续要求其它模型RPC、受保护检查点前的所有模型RPC/ordinary worker、业务写入与外网均为0。审核者没有改作者oracle。应保留完整trace，对实际模型执行/解析授权或其它RPC、非GET/HEAD业务写入、外网与protected时序继续严格检查，不能修改普通Web UI来压掉合法默认配置读取。

`review108-03-input-snapshot.json`记录当前10个script/seed/schema/package/runtime输入、dist10文件、static out237文件和原migrations64文件。`review108-04-build-sourcemap-current-input-check.json`按esbuild URI格式解码源码路径，实际built main152/service375/专用worker82共609个sourcesContent与当前源字节全部一致，包含B03/B04 main/ModelRepository及默认private pipeline。首次未decode `%5Bid%5D`的ENOENT是审核工具读取问题，修正后无source mismatch；没有重建或开启引擎。

`review108-05-attempt02-evidence-check.json`独立核02启动时记录的六个build输出hash与当前一致；它只保存该失败尝试的实际完成范围，绝不授native恢复PASS。

运行中的受控项必须明确：系统picker返回值、准备和启用确认的API返回值、app.relaunch自动spawn被抑制。原app.quit、旧进程exit/ESRCH、下一轮实际built Electron独立PID与实际private worker pipeline不能被受控回调替代。脚本只在isolated seed建立初始条件；后续pointer/request/core文件均由产品流程生成，没有直接改写这些状态绕过恢复。

三个Electron PID必须唯一，原工作台先用原settings关闭restoreSession、完成真正原schema备份、再产生最新未发送输入。Cancel先验证空base/无intent/layout/core/原pointer字节；准备后真实CloseCoordinator→source engine closed/worker exit→armed→原PID退出。第二PID冷memory partition仅暴露state/command/subscribe，不先创建ordinary worker；真实built application-restore-worker使用默认executor，prepare/retention/reseal/source/activation私有proof都在同一个worker中，未从JSON/RPC重建或注入测试operations。

不能直接观察WeakMap私有cap本身；“实际私有proof链执行”结论须由本次input/dist hash、未替换的默认worker执行路径和实际严格激活结果共同支持，不能仅凭DTO或日志文字作结论。

健康分支冷PID的全部engine-open-attempt必须位于独立native base，原source inbox/database尝试次数0，所有打开引擎实际关闭且专用worker退出0。原source完整文件hash、inode/device、mtime/ctime与目录身份冷前后不变；verified beforeSnapshot每项逐一对应原closed source。此beforeSnapshot是实际健康副本校验，不把raw冷保留归为健康。

第三PID首先获得protected bootstrap，实际journal文件proof与两份request/core checkpoint receipt都需一致，第二份磁盘revision/clientRevision严格增加；complete确认发生后request已经consumed，才创建ordinary worker、发布普通bootstrap。两原snapshot全部保留，以APPLICATION_RESTORED只读展示，不重放旧请求/审批；随后新composer输入正常保存到实际新root。最后退出事件/code0/noSignal与teardown逐一确认，不用failure-only SIGKILL取得成功。

## 历史未完成核对范围（已撤销）

原计划核对request/phase/checksum/append-only前序、core receipt/barrier/journal/inventory、完整观察日志及实际process exit，并对照fresh source/dist/schema/migration输入hash、亲看最终窗口。这些核对随需求撤销停止；保留已有失败及其所有隔离fixture，不覆写107/历史。当前无完成运行证据，不授actual native PASS。

即使本次健康链通过，范围仅为macOS开发运行和受控API选择/确认/重启方式；不授真实物理picker、手动系统确认、Windows、安装包或531正式用例验收。

## 用户撤销范围备注（2026-10-08）

用户最新要求取消所有备份功能，root已指示停止108后续备份/恢复native审核。仅记录截至撤销时的证据，不启动测试、不修改生产或冻结manifest。已保留01/02失败尝试及所有隔离fixture，03未实际启动：已读取`native-application-restore-attempt-03/canceled-before-launch.json`，该目录仅保留取消说明，没有runner/run-intent/stages/observations或新PID；只读进程存在性查询确认先前owned PID92377、94104、94157均为ESRCH。不授整条恢复链通过。运行作者负责安全退出其实际owned进程。

撤销前，`review108-06-approved-resume-delta-check.json`只读核对03准备脚本SHA256 `d118078174b5e009ec1c7c245315d54da74bf1d50eff582d757585a31259edff`：观察shim、真实launch/controls/exit、准备以后全部恢复/两检查点/源数据保护断言不变；新增既有02真实备份跨正常重启的明确验证、列表加载等待及root批准的只读defaults例外。107的175项仍changed0。这是harness准备核查，不能代表03原生恢复成功。未完成的真实三PID恢复、私有proof链、源opens0、两实际journal回执及最终窗口验收随备份需求一并撤销；历史107限定审核结论保持原范围。
