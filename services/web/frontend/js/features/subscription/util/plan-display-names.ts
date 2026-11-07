import { TFunction } from 'i18next'

export function getUpgradePlanDisplayName(
  planCode: string,
  t: TFunction
): string {
  if (planCode.startsWith('professional')) return t('pro')
  if (planCode.startsWith('collaborator')) return t('standard')
  return planCode
}
