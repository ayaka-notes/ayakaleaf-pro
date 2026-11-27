import SecuritySection from '@/features/settings/components/security-section'
import { useEffect, ElementType } from 'react'
import { useTranslation } from 'react-i18next'
import importOverleafModules from '../../../../macros/import-overleaf-module.macro'
import getMeta from '../../../utils/meta'
import EmailsSection from './emails-section'
import AccountInfoSection from './account-info-section'
import ManagedAccountAlert from './managed-account-alert'
import PasswordSection from './password-section'
import LinkingSection from './linking-section'
import BetaProgramSection from './beta-program-section'
import LabsProgramSection from './labs-program-section'
import SessionsSection from './sessions-section'
import NewsletterSection from './newsletter-section'
import LeaveSection from './leave-section'
import * as eventTracking from '../../../infrastructure/event-tracking'
import { UserProvider } from '../../../shared/context/user-context'
import { SSOProvider } from '../context/sso-context'
import useWaitForI18n from '../../../shared/hooks/use-wait-for-i18n'
import useScrollToIdOnLoad from '../../../shared/hooks/use-scroll-to-id-on-load'
import { SSOAlert } from './emails/sso-alert'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import { isSplitTestEnabled } from '@/utils/splitTestUtils'
import NotificationsSection from './notifications-section'

// Module-provided settings sections (e.g. the WakaTime coding-statistics
// panel). Each entry is a default-exported component; sections gate
// themselves on their own feature flags.
const settingsEntries = importOverleafModules('settingsEntries') as {
  import: { default: ElementType }
  path: string
}[]

function SettingsPageRoot() {
  const { isReady } = useWaitForI18n()
  useScrollToIdOnLoad()

  useEffect(() => {
    eventTracking.sendMB('settings-view')
  }, [])

  return (
    <div className="container">
      <OLRow>
        <OLCol xl={{ span: 10, offset: 1 }}>
          {isReady ? <SettingsPageContent /> : null}
        </OLCol>
      </OLRow>
    </div>
  )
}

function SettingsPageContent() {
  const { t } = useTranslation()
  const { isOverleaf, labsEnabled } = getMeta('ol-ExposedSettings')
  const inNotificationsSplitTest = isSplitTestEnabled('email-notifications')
  return (
    <UserProvider>
      <OLPageContentCard>
        <div className="page-header">
          <h1>{t('account_settings')}</h1>
        </div>
        <div>
          <ManagedAccountAlert />
          <EmailsSection />
          <SSOAlert />
          <OLRow>
            <OLCol lg={5}>
              <AccountInfoSection />
            </OLCol>
            <OLCol lg={{ span: 5, offset: 1 }}>
              <PasswordSection />
            </OLCol>
          </OLRow>
          <hr />
          <SecuritySection />
          <SSOProvider>
            <LinkingSection />
          </SSOProvider>
          {settingsEntries.map(({ import: { default: Component }, path }) => (
            <Component key={path} />
          ))}
          {isOverleaf ? (
            <>
              <BetaProgramSection />
              <hr />
            </>
          ) : null}
          {labsEnabled ? (
            <>
              <LabsProgramSection />
            </>
          ) : null}
          <SessionsSection />
          {isOverleaf ? (
            <>
              <hr />
              {inNotificationsSplitTest ? (
                <NotificationsSection />
              ) : (
                <NewsletterSection />
              )}
              <hr />
              <LeaveSection />
            </>
          ) : null}
        </div>
      </OLPageContentCard>
    </UserProvider>
  )
}

export default SettingsPageRoot
