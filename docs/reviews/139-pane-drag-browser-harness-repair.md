# 139 · 顶部拖窗任务的既有浏览器 harness 修复

2026-10-09。本轮由主代理指定只修复 `tests/browser` 中既有失败夹具，不修改生产文件，也不修改新的 `pane-window-drag.test.ts`。失败基线为 `/private/tmp/xaanink-drag-browser.log`：160 tests、129 pass、31 fail、0 cancelled/skipped。该日志保留；本轮结果不覆盖历史失败或整应用 530 项正式验收状态。

## 非备份夹具修复

| 文件 | 原失败与当前依据 | 保留的断言 |
| --- | --- | --- |
| `command-catalog-generation-review.test.ts` | 当前实际 generator、`desktop/shared/command-catalogs.generated.json` 与 main trusted catalog 已一致为 Monaco 0.56.0、darwin 417 / win32 401；旧固定数为 416/400。只更新当前 pinned count。 | 完整生成 JSON / shipped JSON / trusted catalog 逐字段相等；ID 唯一；MD/fold 命令存在；空平台、版本错误、源码过期、内容/digest/重复ID破坏均拒绝，实际 build 在失败时不写 bundle。 |
| `configuration-transfer-ui-review.test.ts`、`desktop-modal-commands-review.test.ts` | 读取已不存在的哈希 CSS `.next/static/chunks/2g1tpo-0aaw7s.css`。沿用其他现有浏览器测试做法，列举、排序、读取当前全部 `.css` chunks。 | 原真实 BaseUI popup/focus、单选映射、取消/乱序/失败/重试、modal 命令隔离与 Escape 断言逐条保留。 |
| `desktop-recovery-integration-review.test.ts`、`recovery-preview.test.ts`、`recovery-preview-review.test.ts` | `src/components/desktop/RecoveryDialog.tsx` 现为“保留的草稿列表”“导出草稿”“作品保留的草稿”“没有需要核对的保留草稿。”；测试仍查询旧备份恢复语境的标签。调整精确定位文本并移除无生产消费者的 `workBackup` 假桥。 | 可读正文、未知/空/长记录、截断但完整导出、原记录字节、复制、只读、选中项稳定、请求不执行、失败后保留与可重试、完整隐藏执行元数据均继续断言。 |
| `file-export.test.ts` | fixture `/api/templates/export` 仍返回旧 format，而同一测试期望新 format。实际 `desktop/service/template-library.ts` 的 `export()` 输出 `xaanink-local-templates`；`desktop/shared/template-library.ts` 明确兼容旧/新输入。仅令当前输出 fixture 使用实际新品牌 format。 | 真实 main file export 写入、实际 JSON 内容、无 Key/endpoint、取消/卸载不产生文件、正文/整书 TXT/MD/DOCX/PDF 真实解析和顺序保留。旧输入兼容没有在本测试中被改为拒绝。 |

## 混合 lease 夹具的范围拆分

依据 `docs/backup-scope-retirement.md`、`backup-scope-retirement.json` 的 `BACKUP-LIST-RETENTION` / `WORK-BACKUP-RESTORE`，备份列表、所属作品选择和“校验并恢复”已经退役。该记录及 `docs/reviews/110-backup-removal-code-review.md` 同时明确 writer lease / 异常锁修复继续有效。实际 `src/components/desktop/WorkBackupsPanel.tsx` 已不存在；原源码在 `tests/retired/backups/source/src/components/desktop/WorkBackupsPanel.tsx` 保留。当前 `DesktopApp.tsx` 消费 `work-lease-pending`，挂载真实 `WorkLeasePendingDialog.tsx`，后者仅发送 `{type:'retry'}`。

两个测试文件的整份历史原件先按现有 mixed-originals 约定逐字复制，独立比较 Git HEAD bytes 相等，再改活动副本：

| 历史原件路径 | SHA-256 |
| --- | --- |
| `tests/retired/backups/mixed-originals/tests/browser/work-lease-ui.test.ts` | `04903863b64caca383f599ffbc713ca906705337948bf8348905d5ffbb28381a` |
| `tests/retired/backups/mixed-originals/tests/browser/work-lease-ui-review.test.ts` | `3f35d9c8ea391278de14f2d0f4d3621d2ec64617ad7a8a60ac11bdf08cb443ae` |

活动 fixture 不再导入不存在的备份面板，改为真实 `WorkLeasePendingDialog` / `DesktopApp`。删除假备份列表/恢复桥，并以 Proxy 对任何 backup / restoreWork / restoreApplication 属性读取直接失败；没有用空组件替换 lease dialog。bootstrap fixture 增加当前状态合同所需的 `revision:0`。

| 原开发测试ID | 退役片段 | 当前活动断言 |
| --- | --- | --- |
| LUI23-01 | 备份列表失败、备份所属作品 selector、从该面板开始 repair 的选中 UUID | 当前 pending dialog 精确只发 retry，原 dialog 保持，无 selector；main 的 start UUID 授权仍由未改动的 `tests/unit/work-lease-main.test.ts` 真实 callback/FS 测试负责。 |
| LUI23-02 | 备份 restore/作品切换按钮的互斥 | 实际 retry 单飞；同一 DOM turn 两次 click 只发一个请求；权威回执前 disabled，pending 后屏障保持。 |
| LUI23-03 | **整条纯备份恢复：运行 restore 时禁 repair，取消 restore 再启 repair** | 历史原件保留，活动 glob 不执行；没有 passed/skipped 记录，没有替代产品声明。 |
| LUI23-04 pending/restarting | 备份 restore 和 owner selector 的禁用 | 实际 dialog 屏障、无成功/完成/取消误报、无关闭按钮；restarting 转换仍验证。 |
| LUI23-05 | 失败后保留备份 rows | 当前 repair 异常不暴露私有 cause，dialog 保持，明确重试产生第二个请求。 |
| LUI23-06 | 空备份作品列表的入口规则 | 当前缺 repair bridge 时无请求，安全错误可见，屏障不释放。 |
| LUI23-07 | removed panel 的卸载 | 当前真实 dialog 卸载后晚到 pending 不改变 detached view。 |
| LUI23-13 | 退役备份 section/card 外观 | 实际当前 dialog / 原 Button 在 360px、paper/ink 中无横向 overflow、按钮可达、背景有主题差异、无 PID/私有路径。 |
| WL90-U01 | 晚到备份 list 回执与其 owner selector | 当前真实 DesktopApp 接受晚到 ordinary state revision，再收到 close-cancelled；原正文不变、inert 保持、save disabled、dialog 保持且只有一次 retry。 |
| LUI23-08–12、14；WL90-U02–04 | 无退役 | 原 app 断言保持：close-cancelled/Escape 不解除屏障、狭窄 retry API/单飞、cancelled/异常/非法回执不重开背景、bootstrap 成功/失败不换 dialog flight、卸载忽略晚拒绝、settings/templates/recovery 命令不重开背景。 |

上述是开发测试范围拆分，未修改正式需求ID或范围台账，未重新打开备份生产功能，未将退役项计作通过。

## 实际定向执行

使用 Node.js 24.18.0、已安装 Chromium headless shell，`--test-concurrency=1`；真实浏览器启动获得 sandbox escalation，未安装依赖、未启动 HTTP 服务，均为隔离 page/route/内存 IPC，真实主进程导出仅写临时目录。

```sh
PATH=/Users/dt_flys/.nvm/versions/node/v24.18.0/bin:$PATH \
XAANINK_TEST_CHROMIUM=/Users/dt_flys/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell \
node --import tsx --test --test-concurrency=1 \
  tests/browser/command-catalog-generation-review.test.ts \
  tests/browser/configuration-transfer-ui-review.test.ts \
  tests/browser/desktop-modal-commands-review.test.ts \
  tests/browser/desktop-recovery-integration-review.test.ts \
  tests/browser/recovery-preview.test.ts tests/browser/recovery-preview-review.test.ts \
  tests/browser/work-lease-ui.test.ts tests/browser/work-lease-ui-review.test.ts \
  tests/browser/file-export.test.ts
```

第一次定向日志 `/private/tmp/xaanink-drag-browser-repair-targeted.log`：**60/60 pass，0 fail/cancelled/skipped，exit 0，51.04 秒**。之后加强 WL90-U01 为真实 `state` 回执的过程中，`/private/tmp/xaanink-drag-browser-repair-lease-final.log` 保留 **3 pass / 1 fail**：旧 fixture 缺 `revision` 导致更新未获接纳，断言实际 `undefined !== 1`；仅补 fixture 的 `revision:0`，未改生产或该拒绝断言。

最后对两个 lease 文件的 18 条活动测试重跑：**18/18 pass，0 fail/cancelled/skipped，exit 0，10.57 秒**，原日志 `/private/tmp/xaanink-drag-browser-repair-lease-final2.log`。`git diff --check` 退出 0；两个历史归档与 Git HEAD 原文件逐字比较仍相等。其他七文件保持首次通过后的字节。主代理将独立审核并执行当前全量浏览器回归；此处不声称全量、Electron native 或全部平台验收通过。
