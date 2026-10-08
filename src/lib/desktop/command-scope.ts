export type DesktopCommandScope="none"|"markdown"|"composer"|"input"|"preview"
/** Monaco's find widgets and our comment ViewZones contain ordinary controls.
 * Only its real text surfaces own manuscript commands. */
export function commandScope(target:HTMLElement|null):DesktopCommandScope{
 if(target?.closest('.chat-composer-editable'))return "composer"
 const control=target?.closest('input,textarea,[contenteditable="true"]')
 if(control&&!control.matches('.inputarea,.native-edit-context,.ime-text-area'))return "input"
 if(target?.closest('.monaco-editor'))return "markdown"
 if(target?.closest('.desktop-markdown-editor'))return "preview"
 return "none"
}
