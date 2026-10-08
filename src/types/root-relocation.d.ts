import type {RootRelocationBridge} from "@desktop/shared/root-relocation"
declare global{interface Window{desktopRootRelocation?:RootRelocationBridge}}
export {}
