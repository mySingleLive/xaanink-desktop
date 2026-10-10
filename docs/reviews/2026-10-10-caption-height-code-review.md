# 三栏顶部高度恢复：独立代码审核

结论：通过，无阻断。本轮只审核 `src/app/desktop.css` 的高度/底部 padding 改动与 `tests/browser/caption-alignment.test.ts` 的几何断言增量。没有修改产品或测试，也没有追加全量执行。后续真实 Windows 新包验收及完整套件仍由主代理执行。

将当前 CSS 与 `docs/evidence/caption-height/desktop-before.css` 按 LF 规范化后核对：仅替换说明注释、将 Windows 头部高度 32 改为 44，以及新增 `padding-bottom:calc(12px / var(--desktop-caption-zoom, 1))`，其余完整文本与预期精确相同（只读核对命令 exit 0、`normalizedExpectedEqualsCurrent:true`）。`align-items:center`、`padding-top:0` 与有底边头部的 1 DIP 上内边距/底边补偿均保留。

没有底边时，44 DIP 行高减去 12 DIP 底部 padding 后仍有 32 DIP flex 区；有底边时，扣去 1 DIP 顶部 padding、1 DIP 底边及 12 DIP 底部 padding 后为 30 DIP，中心仍是 `1 + 30/2 = 16` DIP。真实 SidebarWindowControls、ChatPanel header、ContentTabs 的空/非空头部均已由上一阶段核对。Tab 32 DIP、其内部补偿、scroller 居中及所有按钮/SVG 尺寸未被本轮改动。菜单、安全区、原生 overlay/关闭装饰和 Web/mac 样式没有此次源变化。

实际测试与 `caption-test-before.txt` 的增量是固定尺寸/top 检查，以及 ALIGN-01 中的 44 DIP 三头部/正文起点、32 DIP Tab 高度和 scroller 溢出断言。`expectedSize` 由元素类型及所属 Tab/内容头部分类，使用独立常数 28/24/15 和 SVG 16/12/14，不从实现 CSS 读取预期；top 为 `16 - size/2`。宽高误差小于 0.1 DIP、top/centre 不超过 0.6 DIP。五 zoom × 三字号 × 空/单/八 Tab 的现有矩阵保留。原窄布局、handlers/no-drag 与 Web/mac 断言未删改。没有把旧 CSS 复制进长期测试夹具。

已直接读取实际 `tdd-red.tap`：5 项中 4 pass、1 fail，失败为首个 zoom 0.75 场景三个真实头部各 42.65625 CSSpx，约 32 DIP，不符合新 44 DIP 期望；此前执行的固定控件几何检查通过。这是实际几何 RED。另存的浏览器启动失败属于环境失败，不能充当此 RED。

已直接读取完成后的 `targeted-green.tap`：同五个顶层项全部 pass、零 fail/cancel/skip，ALIGN-01 完整矩阵执行约 29.3 秒、总约 34.45 秒。它证明本轮受控浏览器几何与既有交互通过，不证明实际原生菜单、macOS 或整个产品通过。无需重复同一专项测试；最终证据审核继续核对新包来源、实际 Windows 截图/几何和完整结果，保留所有失败/取消及正式 planned 边界。
