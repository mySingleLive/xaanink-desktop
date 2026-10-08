# 75 · 恢复候选、作品存储指针与备份调度独立审核

日期：2026-10-08。审核者：ui_revision_review。主代理实现，审核者只写独立测试、记录和证据，不运行Electron。

## 最终结论与范围

**限定 PASS**。本轮四处真实RED均修复。最终7项新独立检查与8项作者相关回归合计15/15通过；75范围类型检查exit0、空诊断。全量tsc当次被其他在途image-resource测试的未实现API阻断，未称全量类型检查通过。531条正式用例仍 not-run。

范围：`restore-candidate.ts`的包导入/原结构与附件验证/关闭后指纹/未启用候选取消；`work-storage.ts`指针及Host合同；`backup-scheduler.ts`的时钟/单飞/成功时间持久化/暂停。实际Workspaces prepare/activate/cancel、generation读写与引擎切换、main/renderer/原生接线不纳本轮批准。真实PGlite候选测试借用Workspaces创建测试作品，不因此批准正在进行的第76轮接线。独立保护标记通过Options.required/markRequired提供，不要求修改原Web作品manifest；其实际durable writer及启动顺序由76另审。

初始`work-restore-scheduler-frozen-v1.json`的6份源码/作者测试、6份依赖、9份作者证据SHA，以及其明确Python默认json.dumps(sort_keys=True)聚合算法，独立核对全部匹配，aggregate `0568d88300cc6e33cb46f1608982c0b6b4768cd8aa36cf9ad2e417d6f9f46985`。该初始版本包含下述缺陷；最终指纹由`review75-independent-summary.json`记录，不用v1批准修复后代码。

## 实际问题与修复

| 编号 | 独立实际失败 | 最终修复与复验 |
| --- | --- | --- |
| ST75-01 | 指针当前为候选A；准备切B写前，真实rename A并在同路径创建新inode，再使B写前失败。catch只看pointer JSON未变便release(old)，尽管旧候选目录身份已失效。 | old若为candidate，还须验证其recorded目录身份；无法证明旧authority则blocked，不能恢复外部替换目录。 |
| ST75-02 | 新B pointer已rename；sync阶段在同inode目录改变host验证用的候选proof并throw。catch只看目录identity便release(new)。 | 不确定提交后判断new时重新运行host.verify及目录身份校验；host候选证明失效则blocked。pointer仍保留new，不能静默用original。 |
| ST75-04 | 上述候选proof失效，但sync阶段不throw，正常commit仍直接return/release(new)。 | 正常成功返回前同样完整verifyTarget；失效保持blocked并拒绝ACK。新pointer保持其已提交authority，不能回滚为旧库。 |
| RC75-01 | 原schema Scene.exteriorImageUrl为实际`/api/novels/.../scenes/.../images/不存在id/asset`，没有SceneImage/附件。prepare原先只校验`/_desktop/assets/`及已有SceneImage.filename，仍发布ready候选。 | 复用localImageRequest解析已知本地引用，并验证novel/scene/Image记录、filename附件及Scene内外景kind；悬空引用拒绝。同一实际作品补齐合法SceneImage及可解码PNG后，合法包正常生成ready候选，附件原字节及当前作品保持。 |

`review75-storage-red.tap`：3项/1PASS/2FAIL、exit1；`review75-final-target-red.tap`：定向04 1项/1FAIL、exit1；`review75-scene-reference-red.tap`：实际原schema候选1项/1FAIL、exit1。全部是在原模块中执行真实文件操作或真实PGlite，不是静态文本判断。storage的host-ready只是Host验证合同的受控证明，不能称为真实候选引擎验证；RC的导入/SQL/sharp/文件则为真实。

## 新独立覆盖

三个测试文件、7个顶层用例：

- `work-storage-75-review.test.ts` 4项。三项上述old/new/正常commit攻击；另验证有效new在rename后目录sync不确定时仍是磁盘authority，release(new)也要真正await，不能在host尚未恢复业务时结束激活Promise。write hooks只控制真实FS交错；marker、quiesce/pre-restore-backup和业务release为受控Host边界。
- `work-restore-candidate-75-review.test.ts` 1项。原schema实际Scene及备份，拒绝悬空API引用，然后创建正确SceneImage/PNG后确认候选ready、verify可读且附件原字节一致；当前Scene和作品manifest均保持。这不是调用provider或在原作品上执行恢复。
- `backup-scheduler-75-review.test.ts` 2项。backup回调同步重入runNow复用同一flight；pause等待saveLastSuccess ACK，改配置/时间推进不启动新工作；timestamp持久失败的onError观察者可同步pause，无残留重试timer、无成功ACK或热循环。时钟及备份/持久化回调受控，没有把时钟推进当真实定时器或文件fsync。

作者8项也独立重跑：4个真实FS pointer、3个clock scheduler、1个原schema候选集成（包括候选打开后hash失效、取消隔离、active取消拒绝）。不是把其初始GREEN日志当作审核者新增用例；作者更新了成功路径额外verify的事件期望，最终实际命令仍通过。

## 代码判断与实际边界

候选从checked package在新UUID sibling目录导入，先gzip/tar预检；包engine版本由已审WorkBackups约束，实际候选PostgreSQL major与metadata、installed migration ID/checksum与metadata/当前bundle双重一致。检查唯一目标Novel/local author、已知本地附件引用，可解码格式匹配的PNG/JPEG/WebP/GIF才落独占文件。关闭候选engine之后才做文件hash/device/inode与目录inventory并写ready receipt，包含空目录，候选再次打开或修改会失去冻结内容证明。原当前database不被prepare打开/修改；取消保留隔离字节，只改receipt phase，active检查在提交取消前再次执行。Host必须串行化激活和取消，实际锁/owner/停止业务/在途导入取消由76及后续接线证明，本模块没有宣称可立即中断正在导入的引擎。

pointer初始化先写original指针，再让Host持久化独立required标记；标记已要求而pointer缺失/损坏时禁止重建或fallback。activation要求当前revision/required、候选同作品路径/目录身份，Host quiesce必须保留writer lease并返回最后pre-restore backup ID。模块在atomic rename前再次核owner、候选、原pointer，提交后再次核实际pointer及完整候选证明；同一操作持有序列队列直到release完成。失败只按磁盘上实际可证明的old/new恢复；无法证明则blocked。候选开机后文件变化是合法工作数据，旧authority的目录身份校验和新未启用候选的完整验证不同，不能以旧冻结hash否定合法当前写入。Host回调本身是否真正flush/停库/保留原库不是这几个FS fixture所证明的内容。

scheduler在启动和runNow的异步回调前先登记flight，timer/manual复用一份备份，捕获该次retention，只有backup完成及时间写ACK后才resolve成功；持久化失败保持失败且下一次按间隔重试。pause停止接纳/清timer并等待已有starting/flight，观察者异常不阻断后续调度；暂停/恢复及设置接线到实际主进程由后续另审。进程内失败节奏和持久lastSuccess语义保留，不用返回receipt冒充时间已写入。

## 执行与类型检查

Node v24.18.0最终命令：

```sh
node --import tsx --test --test-reporter=tap tests/unit/work-storage-75-review.test.ts tests/unit/backup-scheduler-75-review.test.ts tests/integration/work-restore-candidate-75-review.test.ts tests/unit/work-storage.test.ts tests/unit/backup-scheduler.test.ts tests/integration/work-restore-candidate.test.ts
```

`review75-final-related.tap`：15/15、exit0，fail/cancelled/skipped/todo均0，含7新独立+8作者相关。`review75-scoped-typecheck.txt`：exit0、空诊断；配置与命令保存在`review75-typecheck-scope.json`，extends原tsconfig，只收敛9个75源/测试入口，所有其import依赖仍参与类型检查。

当次全量`review75-full-typecheck-outside-in-progress.txt`：exit2，20条诊断均为新`tests/unit/image-resource.test.ts`引用尚在开发的ModelGateway imageResource/authorizeImageResource/readImageResource接口，没有75诊断；日志保留，不修改他人TDD，不计为75产品失败，也不称全量通过。没有原生窗口、Windows、实际scheduler冷启动/main/workspace激活或断电/真实取消fsync失败测试，没有修改531正式用例状态。
