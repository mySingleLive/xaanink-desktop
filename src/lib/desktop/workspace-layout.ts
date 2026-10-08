import type {WorkspaceLayout} from "./workspace-draft-source"
/** Capture the settled visibility, even during the Web shell's existing animation. */
export function settledWorkspaceLayout(value:WorkspaceLayout):WorkspaceLayout{
 const next=structuredClone(value)
 if(!next.contentVisible){next.chatVisible=true;if(next.narrowPane==="content")next.narrowPane="chat"}
 if(!Object.keys(next.sizes).length)return next
 const sidebar=next.sidebarVisible?next.sizes.sidebar??0:0
 if(!next.contentVisible)next.sizes={sidebar,chat:100-sidebar}
 else if(!next.chatVisible)next.sizes={sidebar,chat:0,content:100-sidebar}
 else {const content=Math.min(next.sizes.content??next.lastContentSize??(100-sidebar)/2,100-sidebar);next.sizes={sidebar,chat:100-sidebar-content,content}}
 return next
}
