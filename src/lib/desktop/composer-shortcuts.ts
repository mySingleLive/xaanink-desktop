import {bindingsFor,canonicalKey,editBinding,type ShortcutCommand} from "@desktop/core/shortcuts"
type Overrides=Record<string,string[]>
const row=(commands:ShortcutCommand[],id:string)=>{const command=commands.find(command=>command.id===id);if(!command)throw new Error("输入命令尚未就绪");return command}
const enter=(binding:string)=>["enter",canonicalKey("Shift+Enter")].includes(canonicalKey(binding))
export function setComposerSendPreset(commands:ShortcutCommand[],overrides:Overrides,enterToSend:boolean):Overrides{
 let next={...overrides,"ai.send":bindingsFor(row(commands,"ai.send"),overrides).filter(binding=>!enter(binding)),"ai.newline":bindingsFor(row(commands,"ai.newline"),overrides).filter(binding=>!enter(binding))}
 try{
  next=editBinding(commands,next,"ai.send",enterToSend?"Enter":"Shift+Enter") as typeof next
  next=editBinding(commands,next,"ai.newline",enterToSend?"Shift+Enter":"Enter") as typeof next
 }catch(error){
  const occupied=commands.filter(command=>!["ai.send","ai.newline","ai.mentionConfirm","ai.mentionClose"].includes(command.id)&&["composer","text","global"].includes(command.scope)&&bindingsFor(command,overrides).some(enter)).map(command=>command.label)
  throw new Error(occupied.length?`发送方式与 ${occupied.join("、")} 的绑定冲突，请在快捷键设置中处理。`:error instanceof Error?error.message:"发送方式保存失败")
 }
 return {...next,"ai.send":[next["ai.send"].at(-1)!,...next["ai.send"].slice(0,-1)],"ai.newline":[next["ai.newline"].at(-1)!,...next["ai.newline"].slice(0,-1)]}
}
export function composerSendPreset(commands:ShortcutCommand[],overrides:Overrides):"enter"|"shift"|"custom"{
 const send=bindingsFor(row(commands,"ai.send"),overrides).map(canonicalKey),newline=bindingsFor(row(commands,"ai.newline"),overrides).map(canonicalKey)
 if(send.includes("enter")&&newline.includes(canonicalKey("Shift+Enter")))return "enter"
 if(send.includes(canonicalKey("Shift+Enter"))&&newline.includes("enter"))return "shift"
 return "custom"
}
export function composerBindingHint(commands:ShortcutCommand[],overrides:Overrides){
 const send=bindingsFor(row(commands,"ai.send"),overrides),newline=bindingsFor(row(commands,"ai.newline"),overrides)
 return [send.length?`${send.join("、")} 发送`:"点击发送按钮",newline.length?`${newline.join("、")} 换行`:"换行快捷键未设置"].join("，")
}
