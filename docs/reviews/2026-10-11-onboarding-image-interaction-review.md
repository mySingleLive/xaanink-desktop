# 新手引导图片入口交互独立静态审核

日期：2026-10-11（Asia/Shanghai）。本轮要求：仙侠拼贴图整体可点击，与下方“配置文生图模型”同效果；悬停手形，并以斜向右移、浮现的配置文字增强视觉表现。

结论：在本次静态审核范围内没有阻断项，可以提交用户继续审核。未打开浏览器、未执行截图驱动、未验证实际动画、字体渲染或键盘交互；旧v2截图与v3审查不是本次交互的运行证据。产品实现仍未开始，UI尚待用户审核。

## 范围与实际执行方法

只读核对 design/onboarding/flow.js、preview.css、viewer.js、capture-preview.mjs，仅创建本记录，没有改动其他文件。使用文件读取与rg定位控件、动作、保存锁、键盘事件、媒体条件及截图脚本定位。

独立执行以下静态检查，全部退出0：

- `node --check design/onboarding/flow.js`
- `node --check design/onboarding/viewer.js`
- `node --check design/onboarding/capture-preview.mjs`
- 使用仓库已安装PostCSS解析preview.css，输出 `CSS parse OK`。

这些结果证明JS/CSS可以解析；不证明浏览器实际执行、资源加载、DOM几何、视觉效果或产品行为。

## 源码结论

| 审核项 | 源文件依据 | 静态结论 |
| --- | --- | --- |
| 整图点击与下方按钮同效果 | flow.js:77 整张图包装为type=button、class=choice-art-trigger、data-action=accept-image；同页footer按钮也使用accept-image；:155–156统一绑定click；:200同一动作设置resumeStep=image并go(image) | 两入口共用同一动作分支，不存在仅视觉悬停而不响应的图片层；不直接保存模型或跳到欢迎页 |
| 键盘语义及焦点 | 整图为原生button且aria-label明确；覆盖层aria-hidden、pointer-events:none；flow.js:211–219保留原生dialog的Escape处理、Tab首尾循环，Enter只对输入/选择或IME组合阻止 | 原生按钮的Enter/Space激活没有被自定义处理拦截；整图与底部按钮都参加Tab顺序。实际浏览器按键结果仍待执行 |
| 保存锁与重复动作 | flow.js:104遍历当前所有button并设置disabled；:109–117提交锁/失败处理；:183–184 act首先判断busy；preview.css:46禁用默认光标，:56–57的增强状态限定not(:disabled) | 图片入口在跳过/保存等待中一起禁用，不能绕开busy；禁用时不能触发悬停增强状态 |
| 手形与斜向右移表现 | preview.css:45手形光标及基础变量；:48轻微缩放；:50暗色衬底；:51斜向光带rotate(-15deg)，位置从39%到64%；:52文案透明度/纵向浮现；:56–57焦点/精细鼠标设置同组变量 | 已有图像、斜向金光、暗底及文字的组合设计声明，移动方向符合右移意图；“酷”的最终视觉评价需用户查看当前版本 |
| 精细鼠标、键盘与触控 | preview.css:56 focus-visible等效增强；:57仅hover:hover且pointer:fine启用hover；原生点击动作无媒体条件；footer保留明确文字入口 | 不依赖hover才能进入配置。无hover触控仍可点图或底部按钮；触控不会为了展示文字被要求多点一次。未声称触控实际通过 |
| 减少动态效果 | preview.css:59取消图片transform/transition，隐藏光带，取消衬底/文字过渡及文字位移 | hover或focus触发时直接显文案，不进行缩放/位移；静止时caption仍按默认透明度，未误记为始终显示 |
| 字体与窄屏约束 | preview.css:53 使用KaiTi/STKaiti/serif回退、22–30px clamp、1.5行高及轻字距；:58窄屏覆盖层扩展到整图、字号17–26px并改暗底；:36图片询问dialog宽640px；:38保留2:1图片比例；通用dialog正文可滚动、头尾不收缩 | 仙侠风格通过楷体与金色装饰表达；窄屏有避免半图文字拥挤的声明。实际字体可用性、文字是否截断与短窗按钮可达仍待渲染核对 |
| 定位与查看器说明 | capture-preview.mjs:80 将同名footer动作限定为.dialog-footer [data-action=accept-image]；viewer.js:9解释整图与按钮同入口及交互效果 | 新增同名原生按钮后，旧截图驱动的底部按钮点击不再产生多元素定位歧义。此脚本本轮没有执行，也尚不能证明图入口实际点击/键盘通过 |

覆盖图层设置pointer-events:none、整图按钮未包含其它交互控件，事件目标仍能回到原生按钮；原生标签和关闭/返回/跳过控件保持原流程含义。没有引入自动生成图片、真实供应商网络调用、产品持久化或不可跳过的图片步骤。

## 尚未执行的验证

本轮严格止于源码和解析检查。需后续实际核对：图片鼠标点击与footer同结果、Enter/Space激活、Tab/Shift+Tab与焦点边框、等待跳过提交时禁用点击、精细鼠标进出动画、触控无hover入口、reduced-motion即时反馈、浅/深主题、窄屏及短窗的文字/按钮可达。

不能用旧静态截图证明新增hover动画、旧v3语法审核证明本次键盘行为，也不能把本记录当产品专项验收。主代理负责同步设计文档/台账；本记录仅绑定上述四个源码文件和本轮实际静态检查。
