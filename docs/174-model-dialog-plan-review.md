# 配置模型目录与剪贴板修复方案独立审核

日期：2026-10-09。审核对象：`docs/173-model-dialog-repair-plan.md`。审核范围仅为该方案及 `ModelConfigurationDialog.tsx`、`input-commands.ts`、`native-text-edits.ts`、`DesktopCommandController.tsx`、IPC/preload/main 菜单相关既有代码。未读取或使用真实凭据，未执行供应商接口，未修改实现。

## 最终结论：通过

复审后的 173 已明确补入以下两项修正，以及菜单返回原控件、strict 布尔校验和 main 销毁时释放 Promise。两项阻断均关闭，可以进入测试用例独立审核。本结论仅为方案通过，尚不表示实现或原生验证通过。

## 首轮问题及关闭依据

1. **目录合并须保留已知访问限制。** 首稿规定公开候选未出现在实时目录时保留为权限未知，但未明确既有 `available:false` 和订阅限定型号的优先级。当前组件在 `ModelConfigurationDialog.tsx:87` 禁用 `available:false` 候选；直接回退公开可选候选会撤销该限制。修订后第 2 条规定 MiniMax 订阅限定默认禁用，只有主进程确认当前凭据支持订阅并返回 `available:true` 才启用；实时 `available:false` 始终优先，下线、OTHER 和纯编辑筛除继续生效。问题关闭。实施及测试仍需防止当前已选项回插绕过这些规则。
2. **标记密码框剪切须明确写入与删除顺序。** 首稿已确认浏览器密码复制路径失败，却仅规定剪切采用原生编辑。现有 `native-text-edits.ts:99` 对普通输入直接调用原生 copy/cut，没有密码框选区写入桥。修订后第 3 条规定复制/剪切先通过 `writeClipboardText` 写选区；只有写入成功且所有权、epoch、值及选区仍一致，才原生 delete，粘贴采用 insertText，不依赖密码框原生 copy/cut。问题关闭。失败、迟到和撤销记录由用例及真实 Electron 验证。

## 已认可的边界与后续验证要求

- 公开目录不需要 Key、不访问网络、不创建配置；单选、重复禁用、手动保存和旧查询撤销继续保留。联网目录只能补入已经按供应商及 TEXT/IMAGE 分类过滤的结果。
- API Key 继续保持密码掩码，只对明确标记字段开放剪贴板命令；默认快捷键应经现有命令所有权路由，并保留用户删除或修改快捷键的行为。
- 修订后第 4 条规定原生菜单只由标记字段 contextmenu/Shift+F10/ContextMenu 调用，返回有限 `text.*` ID/null 到原调用控件，不经全局 `desktop:command` 重新选择焦点；main 销毁/关闭释放 Promise。约束已落入方案。
- 原生菜单必须继续按可信窗口/主 frame 校验、严格布尔结构和固定命令集合构建，不使用能直接编辑 webContents 的原生 role。菜单返回后再核对原控件、焦点、操作 epoch、值和选区。需在真实 macOS Electron 中验证正常 popup 可以完成命令，外部失焦往返、输入、composition、关闭和销毁则取消迟到命令。
- 测试阶段应以旧组件空 Key 无列表和旧密码框复制/剪切失败作为 red 证据；不得仅以新增模块不存在作为失败证据。实际系统剪贴板、React 受控更新与撤销记录需要原生验证。

方案边界与当前授权一致；不存在剩余方案阻断项。后续实现审核需按上述边界和已审核测试用例检查，不将方案通过代替执行证据。
