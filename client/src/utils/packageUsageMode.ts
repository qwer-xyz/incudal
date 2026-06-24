export type PackageUsageMode = 'free' | 'paid'

export type PackageUsageModePlanSummary = {
  total?: number | null
} | null | undefined

export function getPackageUsageModeFromPlanSummary(planSummary: PackageUsageModePlanSummary): PackageUsageMode {
  return Number(planSummary?.total || 0) > 0 ? 'paid' : 'free'
}

export function shouldShowPackageLevelInstanceDefaults(mode: PackageUsageMode): boolean {
  return mode === 'free'
}

export function canSelectPackageUsageMode(planSummary: PackageUsageModePlanSummary, mode: PackageUsageMode): boolean {
  if (mode === 'free' && getPackageUsageModeFromPlanSummary(planSummary) === 'paid') {
    return false
  }
  return true
}
