# 新手引导专项验证

2026-10-11，Windows x64，Node v24.19.0，Electron 44.6.0。仅运行本次目标及直接关联测试，没有全量回归。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 20个限定单元/组件/真实文件事务测试文件 | 189/189，无失败/取消/跳过 | `docs/evidence/onboarding/scoped-tests.json` |
| 生产Next构建（包含TypeScript检查） | exit0 | `node24 node_modules/next/dist/bin/next build` |
| Electron主进程/preload/service构建 | exit0 | `node24 scripts/build-desktop.mjs` |
| Windows编译应用实际引导 | 8组全部通过，renderer错误0 | `docs/evidence/onboarding/windows-electron.json` |
| Windows包资源 | 317项验证通过，PGlite依赖关闭检查通过，未发布 | `release/package-static-win32-x64.json` |
| 实际Windows包的引导 | 8组全部通过，renderer错误0，app.isPackaged=true | `docs/evidence/onboarding/windows-package.json` |

实际Electron覆盖：首次无模型、三种主题持久化、无步骤条、资料校验及恢复弹窗暂停/继续、关闭重开恢复及未提交Key丢弃、TEXT一次默认双用途、图片离线加载/hover/焦点/Enter/Space/返回清草稿、IMAGE默认及完成欢迎、已完成静默启动、普通设置保存按钮兼容、IMAGE-only短提示一次、短流程表单跳过保留原IMAGE、同ID回退编辑不重复、Tab/ShiftTab、宽窗/窄窗退出焦点、800×600与150%应用缩放、80字笔名。

编译应用启动前对主进程及真实service worker安装HTTP/TCP连接和TCP监听拒绝守卫，6种TCP参数形式预检均拒绝；4次实际启动共8次guard加载，产品尝试数0。Playwright Chromium/V8调试端口是测试工具通道，不作为产品HTTP服务。包资源与这组编译产物逐项匹配，图片SHA与批准稿一致。

实际 `release/win-unpacked/玄印写作.exe` 使用隔离目录完成同一8组流程，断言app.isPackaged及appPath，主进程/service/preload与图片SHA都匹配构建。包忽略CLI -r预加载，因此其冷启动是实际观察，guard在启动后由测试工具装入主进程和renderer；4次启动读取Node主进程监听Server均为0，之后观察到的网络尝试均为0。包service worker没有注入guard，严格启动前主进程/worker网络证据来自上面的相同编译产物验证；不能把两组证据混成包启动前全进程抓包。未进行NSIS安装。

Windows脚本调试期间修正了测试夹具：Windows预检用命名管道、初始模态背景的aria-hidden、异步主题确认的等待、同名图片/页脚按钮的范围、供应商菜单渲染等待、真实删除按钮名称、重启后定位器重绑。最后一个短窗焦点失败是产品缺陷，已修复并真实复跑通过。189项首次组合188通过/1失败，原因是旧模型服务测试只等30次setImmediate，未保证实际磁盘读取后fetch进入；改为5秒有界显式入口事件等待，产品服务未改，最终同范围189全部通过。历史失败与TDD记录保留，未将它们标成通过。

物理输入法、系统DPI、多屏、原生头像选择器的人工操作、macOS及NSIS安装没有执行。composition仅合成事件，应用缩放不等于系统DPI；头像真实解码/存储、权限、候选选择取消与已有草稿保留由服务和实际IPC专项覆盖。未调用真实供应商、未用真实Key、未跑全量业务，不新增旧业务的正式验收结论。
