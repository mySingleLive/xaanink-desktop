# 顶部对齐与关闭加粗：受控夹具及关闭证据补充审核

日期：2026-10-10（Asia/Shanghai）。按主代理指定范围只读定位本轮新增依赖错误，并受委托修正确有该错误的三个unit夹具；未改产品、业务断言、native-close-accent独立测试或正式验收状态。此补充不替代最终全量/原生证据审核。

结论：**非绘制业务夹具的依赖边界修正合理，相关新构造错误已消除；全量尚未通过。** 原生关闭后草稿保留与正式正文覆盖应分开记录，不能把原正文未变化误报为丢失，也不能将草稿可查看宣称为直接数据库覆盖成功。

## 定位与修正范围

修正前完整记录现保留为 `docs/evidence/caption-alignment/core-before-fixture-support.tap/json`。在原core-full读取到的`api.BaseWindow is not a constructor`共7项，仅来自以下三个实际bundle夹具：

| 文件 | 同轮新构造错误用例 |
| --- | --- |
| tests/unit/root-maintenance-window-review.test.ts | WCO-F03、W71-01、W71-02、W71-03 |
| tests/unit/root-relocation-100-review.test.ts | RL100-07 |
| tests/unit/root-relocation-window.test.ts | WCO-F03、RW33-09 |

这些fixture用esbuild运行真实maintenance/relocation入口、真实controller/DataRoot/staticUI及隔离文件系统，但Electron对象原本只支持受控BrowserWindow、菜单、session与dialog，没有BaseWindow/ImageView原生绘制。新增accent实际安装被bundle进来后在业务断言之前失败；这不能证明真实Electron不存在该API，也不能通过删产品安装接线解决。

三处现仅将`./native-close-accent`解析为external的`review:close-accent`，在原require边界提供`installWindowsCloseAccent`和`updateWindowsCloseAccentColor` no-op，并明示原生绘制不在此夹具覆盖内。maintenance原runner替身保持；所有业务test正文和断言未改，没有给cold/session检查新增虚假BrowserWindow，也没有放开网络/IPC/目录权限。没有在其它main或navigation fixture找到该错误，未扩大修改范围。

独立CLOSE测试仍执行实际模块和安装调用，未external该依赖：三窗口真实安装接线、真实geometry/raster/controller、相同bounds/cursor恢复、enabled/modal、监听器/timer销毁及真实applyWindowAppearance接线继续覆盖。非绘制fixture通过不被计作原生绘制、Z-order、穿透或目标OS通过。

## 实际复跑

使用bundled Node v24.19.0，执行：

```text
node --import tsx --test --test-reporter=tap --test-concurrency=4 --test-timeout=120000 tests/unit/root-maintenance-window-review.test.ts tests/unit/root-relocation-100-review.test.ts tests/unit/root-relocation-window.test.ts tests/unit/native-close-accent.test.ts
```

工具返回完整TAP footer：**34 tests、29 pass、5 fail、0 cancelled/skip、exit 1**。原7个BaseWindow构造错误对应的用例全部通过，CLOSE独立8项全部通过；没有以no-op覆盖真实accent测试。

剩余失败为RL100-01/02/03、RW33-01、RW33-04。前述三项涉及完成/耐久性/交接，RW33-01是preload路径正则只接受`/`而实际Windows为`\`，RW33-04为RELOCATION_COMMAND_NOT_COMPLETED；均未在本次夹具修正中改断言。修正前同轮完整TAP也记录这五项失败，不能据此升级为“clean仓库已证明的基线失败”或忽略它们。

修正前全量原footer与JSON一致：1739 tests、1596 pass、130 fail、11 cancelled、2 skipped、exit 1。修正后三个tests文件来源hash已变化；重跑中的core-full不能与旧JSON拼成完成结果，也不能只从减去7项推算新全量通过。主代理已保存旧记录，后续应使用新完整footer/来源快照。

## 原生关闭与草稿保留的限定结论

独立读取 `src/components/content/api.ts:31` 及 `src/stores/staged-changes.ts:268,368`：命中白名单的面板修改先record暂存并返回合成回执，不立即发正文写请求；`src/lib/staged-save.ts:225` 明确章节正文PATCH属于CHAPTER_CONTENT暂存。它是已有三阶段流程，本次产品改动没有更改该机制。

`native-close-journal.json`仅记录隔离journal字段和布尔检查，marker在`staged/.../request/body/content`与`recovery/.../latest/value`两处均为true。独立查看 `packaged-retained-draft-marker.jpg`，实际“保留的草稿”弹窗末尾可见“窗口关闭验收：caption-alignment-20261010”验收文字，支持重启后从真实草稿查看入口读取已保留内容。

主代理报告此前由Sky实际点击原生X、driver正常退出，重启后从设置查看草稿并滚到末尾。本补充未复演该点击，截图本身也不单独证明点击方式；完整原生操作/退出记录仍应随最终证据核对。可记录的范围是**原生关闭点击正常退出，隔离草稿持久保留且重启可查看**。不能宣称已确认直接覆盖原正文数据库、完成暂存提交或全部关闭落盘业务；原正文没变化符合上述暂存机制，现有证据不足以称为丢失。

正式W03/W04、全量业务及未执行平台的状态保持。产品代码审核的原生绘制/交互最终门槛仍由后续完整证据审核确认。
