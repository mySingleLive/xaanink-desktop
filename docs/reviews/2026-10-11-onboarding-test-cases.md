# 新手引导专项测试用例

日期：2026-10-11。技术方案及本用例已通过独立审核；此文件定义验收，具体执行结果见专项验证记录，本次不执行全量回归。数据仅为隔离合成夹具，Key不写证据，目录使用系统临时目录。

| ID | 场景、操作与断言 | 验证层 |
| --- | --- | --- |
| ONB-01a | 默认无模型/旧state缺标记自动完整主题入口；已有资料主题模型回填；未完成重开恢复最近步骤；已完成不完整重入 | schema/路由单元、Windows Electron |
| ONB-01b | bootstrap未ready、启动错误、关闭/迁移/lease/恢复优先；暂停后恢复引导；设置/模板/缺模型入口不能叠加，普通原生菜单不穿透 | 门控单元、实际renderer/Electron |
| ONB-02a | paper/ink/system即时持久化，继续等待写完；system原值保留，系统主题解析使用既有逻辑；卡片radio方向键单选、选中勾选、无步骤条/多余主题下文 | 事务单元、Electron |
| ONB-02b | 主题beforeRename失败留页不推进，原文件/主题保持；重试成功；保存期间再次继续/返回/Escape无第二次调用 | 失败注入单元、组件/Electron |
| ONB-03a | 1–80字笔名必填，可选合法邮箱；无效聚焦首字段；真实资料继续和进度同CAS；普通设置仍手动保存，取消无变更 | 事务/资料相关测试、Electron |
| ONB-03b | 头像归一化资源先落盘再引用；CAS失败保留draft可重试；显式取消/返回/卸载清理draft，高优先级只隐藏不清draft，晚到选择不污染；无native picker权限时不把模拟称原生通过 | avatar/service单元、已保存头像回填 |
| ONB-04a | 新建TEXT一次revision同时模型+text默认+review默认+image-choice；重新返回编辑同ID不重复，changed scope空Key拒绝；选用已有无需Key/不复制；类型错误/停用/删除准确拒绝 | repo事务、Electron |
| ONB-04b | provider国产先：DeepSeek第一；原生单选，仅现有支持的IMAGE供应商；保存不测试/生成；mode保留，thinking兼容保留/不兼容default | provider/default单元、Electron |
| ONB-05a | 点击图片与页脚接受均打开IMAGE；图片cursor pointer、hover/focus缩放+楷体提示，无移动光带；reduced-motion无位移；默认状态文案不遮图 | Electron真实图片/样式/键盘 |
| ONB-05b | 图片询问skip/表单skip完成且保留既有IMAGE/default；IMAGE确认一次CAS模型+image默认+完成；完成写失败不欢迎 | repo事务、Electron |
| ONB-05c | 欢迎标题/品牌/真实转义笔名/创作邀请；只有开始创作主动作，关闭/Escape进工作区；无摘要/虚构成果，不创建作品 | Electron |
| ONB-06 | 完成且TEXT数0每renderer会话提示一次；暂不配置、关闭短流程本次不重复；IMAGE-only同样；全停用TEXT不能误当零TEXT；空态、缺TEXT配置动作短流程不主题资料、不自动重发 | 路由/门控单元、Electron |
| ONB-07 | full相邻返回、恢复；短TEXT无返回；返回图片询问/退出清空未存Key，确认TEXT返回用同ID；窗口关闭重开未完成及完成行为 | 状态单元、Electron进程重启 |
| ONB-08a | 写前错误、CAS旧revision、加密失败、非法transition/版本/字段均不发布/不改变磁盘；重复点击锁；字段保留和固定安全alert | repo/schema单元、组件 |
| ONB-08b | rename后同步失败：磁盘完整提交、public reconcile但UI留失败页；同operation/model身份重试重新同步当前权威状态，仍失败则留页；成功不重复ID/加密/authRevision；保留后来settings；变更payload复用身份拒绝；进程重启旧confirm一律拒绝并按磁盘进度恢复 | 真实文件失败注入、组件 |
| ONB-08c | 错sender/frame/session/notready/closing/quitting/迁移/lease/gate拒绝；repo await/头像await/beforeRename中换owner或closing拒绝无发布；请求取消与晚回包不能推进 | 实际handler/service单元、已有configuration取消专项 |
| ONB-09a | 普通save/remove/update保留onboarding；configuration导出不含progress、导入保持localprogress，不受strict snapshot新增字段影响 | repo/configuration-files专项 |
| ONB-09b | 既有任务defaultsSnapshot和pending request不变；新任务默认继承变化；save写队列参与close flush，错误阻止假确认；资料/普通模型行为直接兼容 | 相关settings/default/profile/model测试 |
| ONB-10 | Tab/ShiftTab焦点约束、radio方向键、Escape关闭与busy阻挡、Enter/Space图入口、composition Enter不提交；短native窗口与应用zoom按钮可达，长笔名不溢出；paper/ink；Windows Electron离线真实启动/关重开 | Electron，合成composition单独标记 |
| ONB-11 | 模型默认仍无、无平台fallback；确认网络调用数0；产品无HTTP监听、bitmap离线加载；raw Key不在state进度/public/errors/console/screenshots，Key只用合成密码且截图前清空 | 文件/public断言、Electron网络/监听审计 |

## 执行安排

审核新增边界：post-rename receipt匹配才冻结字段，继续必须越过本地重复模型/Key/头像会话校验，使用专用原 envelope 重试；TEXT/IMAGE真实编辑器、Controller、store与真实文件repo组合验证。已有头像草稿A时，picker B在队列或原生选择器等待中被隐藏取消，B晚到后A仍可保存；测试取消后旧finally不得解锁新保存。原生关闭等待超时必须判失败，强制结束只能用于测试清理，不能算关闭通过。

技术独立审核补充的强制失败用例：后续receipt覆盖后的旧operation固定旧revision拒绝；4096身份容量满拒绝新操作、不淘汰可重放身份；creationId与任意已有模型碰撞拒绝；新建/编辑disabled或错误kind同样拒绝；receipt重试先于已retired头像session核验；主进程重启未知旧receipt confirm一律拒绝（含笔名/endpoint等非秘密字段变化）并从权威步骤恢复。原生关闭中保存失败后取消关闭，原表单字段/错误/冻结payload仍可恢复，不能先卸载丢失；普通设置close flush测试与实际Electron关闭重开各自证明对应层。

最终接口补充：短流程先执行 `start-models` 同CAS保留completed=true并进入text，ack前不挂载模型表单；写失败留入口、同身份重复不会清模型/default，未完成full拒绝此动作。主动重开短入口可以重新回text并编辑原确认ID；这些断言以单元和实际Electron分别执行；短流程step与completed=true组合schema合法，默认模型变化仍只在之后model确认发生。

先新增 `tests/unit/onboarding-repository.test.ts`、`onboarding-service.test.ts`、`onboarding-flow.test.ts` 和store关闭专项，记录失败，再分别实现后台原子动作及前端。实测脚本 `scripts/smoke-onboarding.mjs` 用 Playwright Electron 启动真实 `xaanink://app/`，隔离根运行完整配置、图片跳过/确认、welcome、关闭重启、短入口、普通设置兼容和鼠标/键盘/短窗/zoom；检查HTTP请求无供应商访问并且应用没有监听端口。脚本不能引入测试HTTP服务。必要错误用controlled service和真实文件注入，标记为单元/专项，不冒充native UI故障验收。

直接关联旧用例按改动选取：model-repository、model-defaults、model-configuration/cancellation、profile-settings/profile-ipc、avatar-assets、configuration-files/transfer、settings-close-flush。现有自制hook测试若无法覆盖抽取子组件，改为真实组件测试或让测试执行抽取后的子组件，不能为了保留旧实现结构而复制逻辑。typecheck和构建必须通过，但不记作业务用例数。禁止 `npm test`/全量脚本入口。

证据保存在 `docs/evidence/onboarding/`；只保存测试名称、结果、系统版本、尺寸/zoom、脱敏截图和计数，不保存请求body/Key。native文件选择器操作、物理输入法和系统DPI如果无法在当前环境真实操控，就记录实际限制；应用zoom/合成composition不能冒充它们。主代理负责明确自动通过与人工待验收边界。
