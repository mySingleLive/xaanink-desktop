# 新手引导 HTML 审核稿

入口：index.html。这是首版历史稿，已由父目录 v2 取代；相对资源链接已适配归档位置。原审核记录：../../../docs/reviews/2026-10-11-onboarding-design-review.md。

这是新增桌面引导的交互设计媒介，不是安装版代码。背景只示意弹窗位置，不能替换真实 DashboardShell 等组件。资料、头像与模型为设计占位，只保存在当前页面内存；请勿输入真实 Key。没有供应商网络请求或应用 IPC。

上方审核工具切换完整/仅模型流程、步骤、主题、尺寸、失败状态与既有模型选择。iframe 内为每步独立 dialog；正文在短窗内滚动。按 Escape 暂时退出，入口可演示从未确认步骤继续；刷新重置全部预览状态。

`node design/onboarding/capture-preview.mjs` 检查设计查看器并生成本目录截图与 preview-checks.json。需本机 Google Chrome 和仓库 @playwright/test。该命令不运行产品测试，不验证 Electron、磁盘持久化或真实供应商权限。

v1 于用户要求第二版修订前归档。此目录保留历史预览，不作为当前实施依据。
