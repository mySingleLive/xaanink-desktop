import type {ApplicationRestoreEntryBridge} from '@desktop/shared/application-restore-entry'
declare global{interface Window{desktopApplicationRestore?:ApplicationRestoreEntryBridge}}
export {}
