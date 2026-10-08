import type {editor} from "monaco-editor"
import type {CommandTarget} from "./command-targets"
import {selectionSnapshot} from "@/lib/comment-selection"
import {commandScope} from "./command-scope"
export function editorCommentCommand(instance:editor.IStandaloneCodeEditor,allowed:()=>boolean,open:(snapshot:ReturnType<typeof selectionSnapshot>&{line:number})=>void):CommandTarget<HTMLElement|null>{
 const selection=()=>{
  if(!allowed()||instance.getRawOptions().readOnly)return null
  const model=instance.getModel(),range=instance.getSelection()
  if(!model||!range||range.isEmpty())return null
  const snapshot=selectionSnapshot(model.getValue(),model.getOffsetAt(range.getStartPosition()),model.getOffsetAt(range.getEndPosition()))
  return snapshot.quote.trim()?{...snapshot,line:range.getEndPosition().lineNumber}:null
 }
 return {owner:instance,accepts:target=>!!target&&!!instance.getDomNode()?.isConnected&&!!instance.getDomNode()?.getClientRects().length&&!!instance.getDomNode()?.contains(target)&&commandScope(target)==="markdown",commands:{"md.comment":{enabled:()=>!!selection(),run:()=>{const snapshot=selection();if(snapshot)open(snapshot)}}}}
}
