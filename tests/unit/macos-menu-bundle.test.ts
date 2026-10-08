import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createRequire} from 'node:module'
import {mkdtemp,mkdir,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {desktopMenu} from '../../desktop/shared/command-registry'
const require=createRequire(import.meta.url)
const config=require('../../electron-builder.config.cjs')
require('app-builder-lib')
const {MacPackager}=require('app-builder-lib/out/macPackager.js')
test('actual installed builder retains raw helper name; every native locale supplies the requested short OS menu name',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'xuanxiang-menu43-')))
 try{
  await mkdir(join(directory,'Contents/Resources/en.lproj'),{recursive:true});await mkdir(join(directory,'Contents/Resources/zh_CN.lproj'))
  const info:Record<string,unknown>={}
  const host={appInfo:{productName:config.productName,productFilename:config.productName,version:'0.1.0',buildVersion:'0.1.0'},platformSpecificBuildOptions:config.mac,getIconPath:async()=>null,getResource:async()=>null,info:{config}}
  await MacPackager.prototype.applyCommonInfo.call(host,info,join(directory,'Contents'))
  assert.equal(info.CFBundleExecutable,'玄印写作')
  assert.equal(info.CFBundleDisplayName,'玄印写作')
  assert.equal(info.CFBundleName,'玄印写作','raw runtime name must still locate original helper executables')
  const {installMacMenuLocalization}=await import('../../scripts/macos-menu-localization.mjs')
  const result=await installMacMenuLocalization(directory)
  assert.equal(result.locales,2);assert.equal(result.menuName,desktopMenu('darwin',{})[0].label)
 }finally{await rm(directory,{recursive:true,force:true})}
})
