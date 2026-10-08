# 本地图片读取协议与真实模态命令独立审核

- 日期：2026-10-08。
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批实现作者。
- 结论：**限定范围通过（PASS）**。实际模态缺陷与删除绑定的回归均已修复，没有本批未关闭阻断项。独立执行22/22相关Node测试、7/7隔离Chromium测试、1/1真实worker集成测试；全项目类型检查退出0。新增独立顶层测试共11项，不把重复复跑、主代理原生组或其他阶段累加；531条正式用例保留既有not-run状态。
- 范围：`shared/local-images.ts`、`request-limits.ts`、IPC body schema及限额部分、renderer transport的binary/流式限额变化；main协议的作品/场景image-asset分支及service的image-asset分支；`DesktopCommandController.tsx` 的真实dialog/alertdialog识别、菜单阻隔与Escape归还DOM。本批不覆盖两者其他main/service功能、61配置文件流程或62目录生成；57存储审核不重复计数。
- 本审核只编辑独立测试/报告/证据，不改生产源码，不运行Electron。真实worker使用独立构建文件，不覆盖主代理dist/main、dist/service或生成route目录。

## 实际发现及修复

| 问题 | 独立真实行为失败 | 主代理修复及独立复验 |
| --- | --- | --- |
| MOD60-01–04 · 实际BaseUI模态边界未识别 | 安装的BaseUI Popup呈现role=dialog但未输出控制器要求的aria-modal=true。Dialog按钮及输入中的Escape被禁用全局ai.stop或input.cancel绑定吞掉，1秒后仍未关闭；普通Dialog与AlertDialog均允许native file.save和file.open执行背景命令。 | 统一识别dialog/alertdialog，无需假设aria-modal。菜单全局/编辑命令受阻，text目标须位于对话层；键盘候选在modal时排除global。原六项断言修复后通过。 |
| MOD60-07 · 删除普通输入绑定错误影响最高层关闭 | 首轮修复后，把input.cancel绑定删为[]，对话框输入Escape仍被customized/removedDefault逻辑吞掉。未提供owner的普通输入取消命令不能控制BaseUI本身的dismiss。 | 在菜单/录制守卫后，无修饰Escape且存在Dialog/AlertDialog时reset dispatcher并直接归还DOM。保留最高层原组件处理；不改用户普通输入绑定，也不绕过录制/菜单规则。新增原RED不改断言，最终七项全通过。 |

`review-60-modal-red.tap` 为6项2通过4失败；copy两项原本通过。`review-60-modal-removed-binding-red.tap` 为新增1项真实失败。最终 `review-60-modal-final-green.tap` 7/7通过。

最早 `review-60-modal-initial-attempt.tap` 的copy夹具没有选择文本，真实input adapter正确拒绝复制；补setSelectionRange后重录纯行为RED，并加关闭动画等待。该初次日志保留，不把这两项夹具失败记为产品缺陷。图片配额、协议与worker新测试首次即GREEN，不虚构RED。

## 实际模态交互证据

浏览器挂载当前真实React、BaseUI Dialog/AlertDialog及Controller，执行真实dispatcher、共同命令registry、scope、command targets、input adapter和hook；仅剪贴板/主IPC与通知是内存观察替身。没有替代BaseUI focus trap或以简化role fixture证明真实modal。

Dialog按钮和普通输入Escape均关闭原最高层。普通Dialog与AlertDialog阻止先前可用的背景file.save以及native file.open；同一背景owner在打开modal前实际可执行，避免空handler造成假通过。两类modal内有真实选区的输入仍能菜单复制；陈旧背景target不复制。后者同时受input adapter真实焦点归属约束，不声称仅靠selector实现全部保护。

测试只在1000×800隔离Chromium中执行，没有真实系统菜单、系统剪贴板、物理IME或Windows验证。内存nativeEdit观察收到当前control及内容，不操作用户剪贴板。所有导航由测试内存响应，其他请求abort；未操作主代理的Electron窗口。

## 大图配额与IPC传输

原四类POST图片上传路径（封面、角色、物品、场景）及multipart content-type才获10MiB+128KiB正文额度；其他请求保持8MiB。共享limit与实际Zod request schema一致，header按大小写规范化并拒绝重复；未知后缀、尾slash、query、越界id/编码、非POST或非multipart不扩大限额。额外128KiB是multipart正文总额的有限余量，原上传handler仍检查图片文件自身不超过10MiB，不能由放宽IPC推断每种handler已实际验收。

renderer边读边累计、复制chunk，超额取消实际ReadableStream且在bridge.request前拒绝；独立stream测试先传8MiB再传3MiB，取消确实调用、IPC计数0。有效9MiB multipart以Uint8Array进入bridge，实际FormData解回相同字节，没有转换为巨大的数字数组。Abort/service loss旧回归同时通过，本结论不重新扩大32的全部生命周期范围。

主进程和worker再次parse/校验，不把renderer额度当权威。requestSchema仍可接收有限旧数组以兼容旧契约；正常renderer此次路径使用紧凑binary。配额修改没有放宽路径/头/方法授权或引入远程fetch。

## 本地读取与实际数据库接线

localImageRequest仅认完整作品UUID/图片UUID扩展名和原场景asset路径，拒绝query、hash、percent、backslash及SVG。main image分支只使用此路径调用image-asset，不传文件系统绝对地址或任意RPC method。实际main protocol回调函数体在Node中执行：GET返回精确bytes，HEAD无body但保留长度，MIME白名单、nosniff、限制CSP及private immutable缓存正确；非法地址/主机/方法不调用asset RPC；超大bytes、错误MIME和service错误统一空404，不回显异常路径。这里的service替身不代表Electron protocol注册已独立验收；头像和静态out分支不计入通过范围。

独立IMG60-W01实际构建当前service/index，运行Node worker、真实RPC/Workspaces/PGlite/迁移、原角色和物品handler，使用原DirectoryAuthority给隔离作品目录授权。原角色JPEG保存成jpg，物品可解码PNG实际超过8MiB且小于10MiB，上传/数据库历史/当前URL与读取字节正确。另一作品UUID不能借同文件名读当前作品，跨作品实体请求404，非法图不新增文件或版本；未知路径/SVG/query拒绝。

测试完整close、终止worker并创建新worker，冷启动后角色/物品历史及精确图像bytes保持，作品文件仅在所属assets目录。所有非model.defaults外部RPC都会立即失败，实际计数为0；不调用真实模型、网络或付费provider。PGlite持久数据库与fs在隔离临时目录运行；这不是Electron重启、断电或Windows验收。

私有bundle放在tests/generated的独立随机目录，使外部包可正确解析；没有调用会覆盖主程序的build-desktop脚本，没有修改生成routes。`review-60-worker-build.json` 记录编译入口及bundle SHA，测试finally移除临时bundle/数据库。编译入口SHA与审核收口时service/index匹配；未来其他分支变化不能借旧bundle证明新版本。

## 执行记录与边界

目录为 `docs/evidence/implementation-10/`：

- `review-60-modal-red.tap`：6项2通过4失败，退出1；`review-60-modal-removed-binding-red.tap`：独立新增1失败，退出1。
- `review-60-modal-final-green.tap`：新增独立7/7通过，退出0，0跳过/取消；首轮6项GREEN只作修复过程，不累加。
- `review-60-related-unit-green.tap`：6个文件**22/22通过**，退出0，0跳过/取消，含新增3项及既有19项。`review-60-transport-first-run.tap` 是该3项早期相同测试，不额外计数。
- `review-60-worker-first-run.tap`：新增独立真实worker **1/1通过**，退出0，0跳过/取消；该1例内多个步骤仍只算1顶层case。
- `review-60-full-typecheck.txt`：全项目 `tsc --noEmit --incremental false --pretty false` 退出0，空诊断。
- `review-60-independent-summary.json`：受审版本、实际函数/分支AST指纹、独立测试、CSS/依赖及RED/GREEN记录；整个main/service文件hash仅标识版本，不把未审的配置/退出/模型功能归为本批PASS。

主代理另完成实际macOS arm64 Electron三组，`native-work-images.json` passed=true：原Web封面两次上传/显示/历史回选且同源字节可读；原场景上传/原图预览/移除/历史恢复；窗口关闭重开后scene tab和三个作品资产仍可读。原Escape失败现场 `native-work-images-failure-01.json/png` 保留；本审核只读取主代理结果，没有独立重跑其native GUI。setInputFiles提供隔离图片，不能称为OS文件选择器验收；未证明真实provider、Windows、系统崩溃或全部531正式用例。

本结论批准上述图片IPC配额/本地协议读取与真实模态命令修复的有限范围，配置导入导出、目录生成、其他main/service权限及最终双平台验收继续单独审核。
