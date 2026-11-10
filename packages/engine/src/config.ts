/** Tunable economy rules. Changing these never rewrites history; they apply going forward. */
export const ECON = {
  /** Personal starting capital issued to each new player (documented money source). */
  starterGrant: 600_000_000,
  /** Daily household transfer issued by the central bank, plus a per-active-company component. */
  householdStimulusBase: 600_000_000,
  householdStimulusPerCompany: 25_000_000,
  /** Share of households' cash spent per open half-hour tick, before price effects. */
  householdSpendPerTick: 0.012,
  /** Customers one on-shift sales employee can serve per half hour. */
  customersPerSalesStaff: 45,
  /** Outside option weight in the household choice model (unserved demand). */
  outsideOption: 0.6,
  bankCapital: 400_000_000_000,
  loanRateDailyBp: 35, // 0.35% per game day
  loanMaxMultipleOfEquity: 2,
  freightPerUnitKm: 12,
  freightMin: 150_000,
  truckKmPerHour: 40,
  handlingHours: 3,
  taxDueDays: 3,
  licenseFeeIncluded: true,
  peoplePoolSize: 220,
  bankruptcyAfterInsolventDays: 7,
  ipo: { minStage: 3, minAgeDays: 14, minEmployees: 8, requireProfitMonths: 1 },
} as const;

export const CHANNEL_RULES: Record<string, { delayHours: number; pointsPerMillion: number; maxDaily: number }> = {
  to_roi: { delayHours: 2, pointsPerMillion: 0.9, maxDaily: 6 },
  mang_xa_hoi: { delayHours: 6, pointsPerMillion: 0.7, maxDaily: 14 },
  bao_chi: { delayHours: 12, pointsPerMillion: 0.5, maxDaily: 18 },
  truyen_hinh: { delayHours: 24, pointsPerMillion: 0.35, maxDaily: 30 },
};
