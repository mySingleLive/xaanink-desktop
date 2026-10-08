import type { DesktopBridge } from "@desktop/shared/ipc"
import type { RootMaintenanceBridge } from "@desktop/shared/root-maintenance"
declare global { interface Window { desktop?: DesktopBridge; desktopMaintenance?: RootMaintenanceBridge } }
export {}
