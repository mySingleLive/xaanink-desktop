# 新手引导专项测试用例独立审核

日期：2026-10-11。审核人：独立子代理 `/root/onboarding_design_review`。用例作者为主代理；本审核未编写实现或测试。

## 结论

**通过测试用例审核，可按范围开始 TDD。** 已先完成技术方案审核，再复读最终用例文件；技术修订及短流程 `start-models` 接缝均已纳入强制断言，没有剩余阻断。

通过的是用例设计。未执行任何本次业务用例、Electron、渲染或全量回归；不声明产品已完成、测试已通过或目标系统已验收。用户已批准最终 UI，不需重复批准。

## 依据与方法

静态读取 `docs/reviews/2026-10-11-onboarding-test-cases.md`、最终技术方案及接口附录、产品设计，核对 ONB-01…11 与用户最新范围。通过 `rg --files` 核对已有相关测试及 Electron 脚本；读取 `package.json`、`tests/unit/profile-ipc.test.ts`、`tests/unit/settings-close-flush.test.ts`，确认计划可用真实 handler/store 进行专项测试。

`package.json` 的 `test` 会展开全部 unit/integration，所以最终执行必须显式列出本次测试和必要关联文件，不能使用 `npm test`。既有 profile-ipc 执行真实 handler 源码并控制 Electron 依赖，不代表原生选择器 UI；既有 close-flush 执行真实 desktop store，不代表窗口关闭实测。这两层仍需按文件中的声明分别记录。

## 覆盖复核

| 契约 | 用例与证据计划 | 判断 |
| --- | --- | --- |
| 首次、旧 state、已有配置、完整恢复和优先级 | ONB-01a/b、07；schema/路由/门控单元加真实 Electron 关闭重开 | 覆盖缺标记、单次入口及真实初始化之后触发 |
| 主题即时保存及系统值，资料手动确认与原组件行为 | ONB-02a/b、03a/b、09b | 区分即时主题与手动资料；失败留页、字段与头像草稿保留 |
| 文本/审核默认原子绑定、单选、编辑同 ID | ONB-04a/b、08a、执行安排强制失败用例 | 包括新建/编辑/现有分支的 kind、enabled、creationId 碰撞与 scope Key 拒绝 |
| 图片两处跳过、默认绑定、欢迎页 | ONB-05a/b/c、07、10 | 保留既有图片设置；只有完成记录确认后欢迎；图和页脚共用动作、无移动光带及键盘/减少动态效果 |
| 零 TEXT 短入口与持久化起点 | ONB-06、最终接口补充 | 明确 TEXT 包含停用记录；start-models 原子进入 text，ack 前不显示表单，失败停入口，未完成 full 拒绝，completed=true 短步骤 schema 合法 |
| 写前/写后失败、身份重试与并发 | ONB-08a/b、执行安排强制失败用例 | 真实文件 rename 后失败保留已提交状态；UI 留失败页；固定原 envelope 重试只同步权威态，不重复 ID/加密/authRevision，不覆盖后来设置 |
| 主进程权限、异步失效及关闭生命周期 | ONB-08c、03b、09b、执行安排强制失败用例 | sender/frame/session/ready/closing/quitting/迁移/lease/gate 均拒绝；高优先级隐藏不清草稿；取消失败关闭恢复冻结 payload、字段与错误 |
| 直接兼容、任务快照、保密与离线 | ONB-09a/b、11 | 普通 save/remove/update 保留进度；严格导出投影及导入保留本机进度；既有任务不重发；无 HTTP/provider 调用，Key 不进进度/public/错误/证据 |
| 键盘、真实短窗、zoom 与证据边界 | ONB-10、执行安排 | Electron 产品界面实测；合成 composition、应用 zoom 与物理 IME/系统 DPI 区分；限制据实保留 |

## 本轮要求的修订已落入用例

- ONB-08b 已将“重启 receipt 核对”改为旧 confirm 一律拒绝、按磁盘进度恢复；同进程变更秘密或非秘密 payload 复用身份拒绝。
- 执行安排明确最后 receipt 被覆盖后的旧 revision 拒绝、4096 身份容量满不淘汰、creationId 碰撞拒绝、已 retired 头像会话之前核对 receipt、关闭失败取消后不丢字段。
- ONB-08c 增补 quitting、迁移和 lease 主进程准入；ONB-03b 区分显式卸载清理与高优先级隐藏保留。
- 最终接口补充要求 start-models 正常、失败、同身份重复、未完成 full 拒绝、短步骤 schema 和主动重开编辑同 ID，单元与真实 Electron 分层证明；不能只在 renderer 跳步而漏测磁盘状态。

## 执行记录要求

上述表格和强制失败补充共同构成专项通过条件。TDD 应保存实际失败及修复后的命令退出结果；原子性断言检查真实 state/revision/default/progress，一次替换以实际提交计数证明，不能只数 UI 点击。错误及门控测试应调用实现的 service/handler，组件测试执行抽取后的真实组件，不能复制动作逻辑。

最终清单需逐项绑定测试名称、层级和证据路径；typecheck/build 独立记录，不计业务通过数。截图只含合成资料，填 Key 前拍摄或清空输入后拍摄，不输出请求正文。原生文件选择器、物理输入法或系统 DPI 尚无真实证据的项目记录限制，不以 mock、HTML 旧截图或应用 zoom 代替。专项通过后再出产品总结；本记录不预先授予这些结果。
