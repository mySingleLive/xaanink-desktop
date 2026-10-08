import assert from "node:assert/strict"
import { test } from "node:test"
import { desktopMenu, platformCommands, electronAccelerator } from "../../desktop/shared/command-registry"
test("macOS and Windows keep their approved top level menus and platform destinations", () => {
  const mac=desktopMenu("darwin",{}),win=desktopMenu("win32",{})
  assert.deepEqual(mac.map(menu=>menu.label),["玄印","文件","编辑","视图","窗口","帮助"])
  assert.deepEqual(win.map(menu=>menu.label),["文件","编辑","视图","窗口","帮助"])
  assert.equal(mac[0].items.some(item=>item.id==="app.about"),true)
  assert.equal(win[0].items.some(item=>item.id==="app.settings"),true)
  assert.equal(win.at(-1)!.items.some(item=>item.id==="app.about"),true)
  assert.equal(platformCommands("win32").some(command=>command.id==="app.hide"),false)
})
test("menu and shortcut settings share IDs; first confirmed binding appears and empty never restores defaults", () => {
  const menu=desktopMenu("darwin",{"file.save":["Cmd+Alt+S","Ctrl+S"],"file.open":[]})
  const file=menu.find(menu=>menu.id==="file")!
  assert.equal(file.items.find(item=>item.id==="file.save")!.binding,"Cmd+Alt+S")
  assert.equal(file.items.find(item=>item.id==="file.open")!.binding,undefined)
  assert.equal(desktopMenu("win32",{})[0].items.find(item=>item.id==="file.save")!.binding,"Ctrl+S")
})
test("native accelerators translate physical keys; chords stay displayable without invalid Electron accelerators", () => {
  assert.equal(electronAccelerator("Cmd+Shift+Equal"),"Cmd+Shift+=")
  assert.equal(electronAccelerator("Ctrl+ArrowLeft"),"Ctrl+Left")
  assert.equal(electronAccelerator("Ctrl+K Ctrl+B"),undefined)
  assert.equal(electronAccelerator("Win+E"),"Super+E")
})
test("OS reserved roles keep their defaults even if disk overrides were tampered with", () => {
  const menu=desktopMenu("darwin",{"app.hide":[],"app.quit":["Cmd+Y"]})
  assert.equal(menu[0].items.find(item=>item.id==="app.hide")!.binding,"Cmd+H")
  assert.equal(menu[0].items.find(item=>item.id==="app.quit")!.binding,"Cmd+Q")
  assert.equal(menu.at(-1)!.items.find(item=>item.id==="help.docs")!.enabled,false)
})
