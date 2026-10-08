# 本地头像资产核心独立代码审核

日期：2026-10-07（Asia/Shanghai）。审核者：独立子代理；与头像核心实现作者不同。范围：`desktop/main/avatar-assets.ts` 与 `tests/unit/avatar-assets.test.ts`。未改核心实现，独立追加必要回归、复跑实际解码与隔离文件操作。原生picker/IPC排序、用户编辑界面、全局资料提交接线另见审核42；本文件不把它们宣称完成。

## 当前结论

**当前头像资产核心限定审核通过。** 独立Node24.18.0执行18项全部通过，0失败/取消/跳过，退出码0，证据为 `docs/evidence/implementation-04/avatar-assets-review-green.tap`。两个独立首审缺陷及随后picker请求代次衔接缺陷已闭合。该结论不等于真实系统选择器、Windows、安装包或完整头像/资料验收。

## 实际发现与修复

**AVR41-01：取消从未begin的会话后仍可复活。** 原cancel未知session直接return；界面仅修改文字、从未选择头像时，main尚未登记会话。队列中的资料保存晚于取消到达，begin仍能成功。独立真实service探针确认cancel→begin→assertActive成功。追加AVATAR-14后，14项13通过/1失败，`implementation-04/avatar-assets-review-red.tap`保留“Missing expected exception”RED。

修复后，未知有效UUID也按owner登记轻量retired；重复取消幂等，另一owner相同UUID及既有会话不受影响，begin同owner旧ID拒绝。retired与live容量有界，live取消保留退役空间；容量饱和时阻止新begin，不淘汰旧取消ID来复活请求。main首个await前登记/await后核验由42另审，核心修复不自动证明接线正确。

**AVR41-02：替换文件失败使仍显示的旧有效头像草稿不可保存。** 原stageSelected开始即清draft；批准原型和ProfileSettings均在新图失败时保留A预览，main却使persistDraft(A)得到DRAFT_UNAVAILABLE。追加AVATAR-15：真实PNG A→损坏PNG拒绝→保存A，15项14通过/1失败，证据 `implementation-04/avatar-replacement-review-red.tap`。

修复后，A保留至B实际解码成功；新读代次仍取消旧读/隔离迟到响应。persist检查当前session与draft对象身份，成功B替换后A拒绝。作者另加AVATAR-16，真实临时文件暂停A在rename之前→B成功→A写入拒绝且临时文件清理；精确assertActive(A)拒绝，成功A的旧cleanup不能取消B，B可保存。作者的 `avatar-assets-05-replacement-red.tap`（15/16失败）与 `avatar-assets-06-replacement-green.tap`为作者证据；本审核者随后独立复跑，不混称同一次运行。

**AVR41-03 / 42接线衔接：代次必须在系统picker返回前分配。** 独立42的真实main-handler回归复现后返回旧picker覆盖新B，保存B失败。作者新增beginSelection，在弹picker前推进读代次并abort旧读；stageSelected接受冻结序号，只有最新且一次消费，取消新picker无文件时仍阻止旧读写回且保留原有效草稿。作者AVATAR-17/18的 `avatar-assets-07-picker-red.tap`与08 GREEN保留；本审核者已阅读该修复与main调用并独立18/18复跑。实际main-handler乱序回归属于42另行6项检查，不等于原生picker乱序实测。

## 已核对核心边界

- 仅main持有源文件路径；renderer得到随机draftId、规范化PNG data URL、尺寸和字节数，不得到选中原路径。目录、非支持内容及截断伪PNG拒绝；扩展名不能代替实际解码。
- 真实Sharp解码PNG/JPEG/WebP，EXIF方向旋转，剥离原metadata，不放大小图；输出边长不超过512、输出2MiB限界。输入10MiB、像素1600万、准备并发与会话数均限界；仅本次明确验证的animated WebP拒绝，不将该测试扩写为所有动画格式实测。
- 读源文件逐块限界并检查abort，拒绝文件/目录符号链接；取消释放业务准备名额，迟到注入宿主读不能写回draft。代码不会强制终止故意忽略abort的宿主I/O；本次相关测试证明业务结果隔离及新请求可用，真实原生读按signal检查。
- owner+session隔离；cancel取消整个会话，cancelOwner仅清相应owner，close使全部失效。可选draftId的核验/清理指向被冻结的同一草稿，旧成功写入的cleanup不能取消新草稿。
- 预览内存阶段不写资产；persist使用私有临时文件、数据sync、原子rename和本平台目录sync。未rename失败清tmp，规范化draft保留可重试；rename后sync失败不返回已确认资源，重试沿同一assetId收敛，避免增加多个副本。
- 持久assetId与draftId不同，UUID路径解析，资源读取有字节上限及PNG签名检查；不沿任意renderer路径读盘。实际存储位于数据根 `assets/global`。正常规范化源来自本服务；本次未把外部损坏磁盘的PNG签名检查当作完整图像校验。
- 该服务不提交用户资料。caller必须在CAS开始前检查session及指定draft，在成功回执后精确清理；CAS失败后的资产可能已经存在但尚未被资料引用，保留供同草稿重试。本次不宣称无孤立资产、完成清理策略或备份/迁移接线。

## 验证及边界

独立命令：`node --import tsx --test --test-reporter=tap tests/unit/avatar-assets.test.ts`，实际文件18项通过。测试包含真实Sharp、临时目录与POSIX文件权限/符号链接，公开生成的小图片，取消/迟到的受控read和rename/sync故障注入；未读取用户真实图片或覆盖真实资料。

源码中Windows跳过目录fd sync，有已flush文件与rename，但Windows崩溃持久性、系统picker、OS原生权限与路径行为未由macOS单元运行证明。main已在弹picker前调用beginSelection并把代次交stageSelected，42的实际handler回归独立覆盖；该受控回执排序不证明操作系统真实picker交互。本报告不把模型原型、历史桌面截图或正式顶层用例计为头像验收通过。
