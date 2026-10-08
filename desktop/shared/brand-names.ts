export type BrandFamily = "legacy" | "current"
export interface BrandNames {
  family: BrandFamily; appMarker: string; appIdentity: "Xuanxiangxiezuo-Desktop" | "XaanInk"
  workManifest: string; storage: string; storageRequired: string; lock: string; audit: string; auditType: string
  leaseTemporaryPrefix: string; restores: string; preserved: string; migrationStagePrefix: string; rootRecoveryPrefix: string
}
/** Historical values are file protocols, never product display text. */
export const LEGACY_NAMES: Readonly<BrandNames> = Object.freeze({ family: "legacy", appMarker: "xuanxiang-app.json", appIdentity: "Xuanxiangxiezuo-Desktop", workManifest: "xuanxiang-work.json", storage: "xuanxiang-storage.json", storageRequired: "xuanxiang-storage-required.json", lock: ".xuanxiang-lock", audit: ".xuanxiang-lease-recovery.json", auditType: "xuanxiang-work-lease-recovery", leaseTemporaryPrefix: ".xuanxiang-lease-recovery-", restores: ".xuanxiang-restores", preserved: ".xuanxiang-preserved", migrationStagePrefix: ".xuanxiang-migration-", rootRecoveryPrefix: ".xuanxiang-root-recovery-" })
export const CURRENT_NAMES: Readonly<BrandNames> = Object.freeze({ family: "current", appMarker: "xaanink-app.json", appIdentity: "XaanInk", workManifest: "xaanink-work.json", storage: "xaanink-storage.json", storageRequired: "xaanink-storage-required.json", lock: ".xaanink-lock", audit: ".xaanink-lease-recovery.json", auditType: "xaanink-work-lease-recovery", leaseTemporaryPrefix: ".xaanink-lease-recovery-", restores: ".xaanink-restores", preserved: ".xaanink-preserved", migrationStagePrefix: ".xaanink-migration-", rootRecoveryPrefix: ".xaanink-root-recovery-" })
export const BRAND_NAMES = Object.freeze([LEGACY_NAMES, CURRENT_NAMES])
export const otherBrandNames = (names: Readonly<BrandNames>) => names.family === "legacy" ? CURRENT_NAMES : LEGACY_NAMES
/** Journal validation is pure and must not read a source already cleaned up. */
export function migrationBrandNames(stage: string, id: string): Readonly<BrandNames> {
  const names = BRAND_NAMES.find(value => stage === value.migrationStagePrefix + id)
  if (!names) throw Error("JOURNAL_INVALID")
  return names
}
