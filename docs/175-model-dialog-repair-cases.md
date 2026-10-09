# 配置模型回归用例

依据：173 方案；执行前须完成 174、176 独立审核。每项都须在 178 报告绑定实际结果，不能把组件替身算作原生验证。

| ID | 输入与操作 | 预期及验证层 |
| --- | --- | --- |
| D01 | 遍历全部 12 家文本供应商，Key 空白打开模型列表 | 立即有官网精确候选、可搜索单选、无需请求；unit + 实际 Electron |
| D02 | 遍历全部 8 家文生图供应商，Key 空白 | 有对应图片候选，排除语音/视频/纯编辑型号；unit + 实际 Electron |
| D03 | 选候选再填假 Key | modelId/name/capacity/effort 随选择，仍单选；没点保存没有模型落盘；component + native |
| D04 | 切供应商、文本/图片新对话框、改 Key | 旧 Key/选项/查询状态不串供应商；晚到查询丢弃，Key 改变保留已选型号；component + native |
| D05 | 联网目录成功覆盖同 ID、含新增 ID；同 ID 返回 available:false | 不重复，返回容量/effort/权限覆盖，拒绝优先仍禁用；离线候选未列出仍为权限未知；unit + component |
| D06 | 查询报认证错误、网络错误、不完整；刷新后恢复 | 候选仍可见，真实错误和完整性提示保留，刷新可重试；component |
| D07 | 已添加重复型号、订阅限定普通→订阅→改 Key、已下线、旧保存型号 | 重复与订阅限制禁用，只有认证订阅确认启用，改 Key 撤销此启用；下线/OTHER/纯编辑不能经实时新增或当前选择回插恢复可选；旧保存选择不丢失但不是新推荐；unit + component |
| D08 | 自定义供应商 | 保留名称/协议/URL/ID/Key 手填，没有混入内置候选；原有保存及测试回归 |
| K01 | API Key 掩码字段选中局部，默认 Cmd/Ctrl+C | 系统剪贴板仅有选区，输入始终 password；unit + 实际 macOS Electron |
| K02 | 默认 Cmd/Ctrl+V 替换选区，撤销重做 | 假文本正确进入受控 React 值与草稿，撤销还原；native |
| K03 | 右键、Shift+F10 或 ContextMenu 键 | 实际 Electron 原生菜单含撤销/重做/剪切/复制/粘贴/全选；点击命令作用于该字段；unit + native |
| K04 | 选区剪切、撤销；无选区、readonly、disabled | 选区写系统剪贴板后原生删除；空选区 copy/cut 禁用；readonly 允许 copy/selectAll，禁止 cut/paste/undo/redo；disabled 不执行；unit + native |
| K05 | 非授权的普通密码框、普通文本输入、composer/editor；标记 API Key 的用户修改/移除 copy/cut/paste 绑定 | 普通密码仍禁止 copy/cut；API Key 默认特判不得绕过用户绑定，移除默认键不执行，改绑后只有新键走命令；其他输入现有语义保留；unit + browser 回归 |
| K06 | 菜单或异步剪贴板等待时失焦 A→B→A、selection/value 改变、composition、销毁、新操作、取消；main 菜单关闭/窗口销毁 | 旧响应不修改新目标，A→B→A 不恢复授权；失败写入不剪切；取消/关闭/销毁释放 Promise；unit + browser |
| K07 | 菜单桥非法结构/多余属性/非布尔/伪命令、不可信窗口 | strict schema 只接受有限布尔状态，可信主窗口与生命周期校验；unit + 源码审核 |
| K08 | 复制粘贴/菜单失败，Key 留空编辑或取消 | 错误不含凭据；保存 Key 不回填，不增加明文属性、日志或测试证据；unit + native + 审核 |
| R01 | 原有所有 unit/integration/browser suites | 所有运行的测试通过，保留业务与协议回归 |
| R02 | typecheck、完整重新构建、编译产物离线启动 | exit 0；隔离真实 macOS 应用，无默认模型、HTTP/TCP 尝试或监听；native offline guard |

TDD：先补 D01/D02/D03、K01/K04 的旧实现回归，保存失败数量与命令；再实现其余用例。官方 API 权限验收沿用前轮，不以公开候选或本地假值声称逐型号调用成功。本轮覆盖以上全部用例。
