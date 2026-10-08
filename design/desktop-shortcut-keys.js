/* Pure keyboard naming/validation for the UI prototype; does not register shortcuts. */
(function(root){
  function canonicalKey(key){return key.replace(/⌘/g,'Cmd').replace(/⇧/g,'Shift').replace(/Command|Meta/ig,'Cmd').replace(/Control/ig,'Ctrl').replace(/Option/ig,'Alt').trim().split(/\s+/).map(chord=>{const parts=chord.toLowerCase().split('+');const plus=parts.indexOf('plus');if(plus>=0){parts[plus]='equal';if(!parts.includes('shift'))parts.push('shift');}return parts.sort().join('+');}).join(' ');}
  function validShortcut(key){return key.trim().split(/\s+/).every(chord=>{if(!/^(?:(?:Cmd|Ctrl|Alt|Shift|Meta|Command|Control|Option)\+)*(?:[a-z0-9,.;`]|F(?:[1-9]|1[0-9]|2[0-4])|Enter|Escape|Tab|Space|Backspace|Delete|Home|End|Arrow(?:Left|Right|Up|Down)|PageUp|PageDown|Plus|Minus|Slash|Equal|BracketLeft|BracketRight|Backslash|Quote|IntlBackslash|Insert|CapsLock|NumLock|ScrollLock|PrintScreen|Pause|ContextMenu|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma))$/i.test(chord))return false;const parts=canonicalKey(chord).split('+');return new Set(parts).size===parts.length;});}
  function shortcutConflicts(a,b){if(!a||!b)return false;const x=canonicalKey(a),y=canonicalKey(b);return x===y||x.startsWith(y+' ')||y.startsWith(x+' ');}
  function capturedKey(event){
    if(event.isComposing||event.keyCode===229||event.repeat||!event.key||['Control','Shift','Alt','Meta','AltGraph','Dead','Unidentified'].includes(event.key))return null;
    const punctuation={Comma:',',Period:'.',Semicolon:';',Backquote:'`',Minus:'Minus',Slash:'Slash',Space:'Space'};
    let key=event.key,code=event.code||'';
    if(/^Key[A-Z]$/.test(code))key=code.slice(3);
    else if(/^Digit[0-9]$/.test(code))key=code.slice(5);
    else if(punctuation[code])key=punctuation[code];
    else if(/^(Equal|BracketLeft|BracketRight|Backslash|Quote|IntlBackslash|Numpad.+)$/.test(code))key=code;
    else if(key===' ')key='Space';
    else if(key==='+')key='Plus';
    const binding=[event.metaKey&&'Cmd',event.ctrlKey&&'Ctrl',event.altKey&&'Alt',event.shiftKey&&'Shift',key].filter(Boolean).join('+');
    return validShortcut(binding)?binding:null;
  }
  const api={canonicalKey,validShortcut,shortcutConflicts,capturedKey};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DESKTOP_SHORTCUT_KEYS=Object.freeze(api);
})(typeof window!=='undefined'?window:this);
