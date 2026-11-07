import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useState } from 'react'
import { postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import MendeleyLogo from '@/shared/svgs/mendeley-logo'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

/**
 * Mendeley account linking widget for the Account Settings page.
 * Linking uses Mendeley's OAuth 2.0 flow: the "Link" button starts the flow at
 * /user/mendeley/oauth, which redirects to Mendeley and, on the callback, stores
 * the resulting tokens and redirects back with ?oauth-complete=mendeley (or
 * ?oauth-error=mendeley on failure), which drives the success/error notice below.
 * Unlinking asks for confirmation and removes the stored credentials.
 *
 * Registered via overleafModuleImports.referenceLinkingWidgets.
 */
function MendeleyWidgetInner() {
  const { t } = useTranslation()
  const user = getMeta('ol-user')
  const refProviders = user?.refProviders || {}
  const [isLinked, setIsLinked] = useState(Boolean(refProviders.mendeley))
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)

  // Outcome of the OAuth redirect (?oauth-complete=mendeley / ?oauth-error=mendeley)
  const [oauthResult] = useState<'success' | 'error' | null>(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('oauth-complete') === 'mendeley') return 'success'
    if (params.get('oauth-error') === 'mendeley') return 'error'
    return null
  })

  // Drop the query param so the notice doesn't reappear on refresh
  useEffect(() => {
    if (!oauthResult) return
    const url = new URL(window.location.href)
    url.searchParams.delete('oauth-complete')
    url.searchParams.delete('oauth-error')
    window.history.replaceState({}, '', url.toString())
  }, [oauthResult])

  const handleLink = useCallback(() => {
    window.location.assign('/user/mendeley/oauth')
  }, [])

  const handleUnlink = useCallback(async () => {
    setProcessing(true)
    setError('')
    try {
      await postJSON('/mendeley/unlink')
      setIsLinked(false)
    } catch (err) {
      setError(t('generic_something_went_wrong'))
    } finally {
      setProcessing(false)
      setShowUnlinkConfirm(false)
    }
  }, [t])

  return (
    <div className="settings-widget-container">
      <div>
        <MendeleyLogo />
      </div>
      <div className="description-container">
        <div className="title-row">
          <h4>{t('mendeley')}</h4>
        </div>
        <p className="small">
          {t('mendeley_sync_description', {
            appName: getMeta('ol-ExposedSettings')?.appName || 'Overleaf',
          })}
        </p>
        {oauthResult === 'success' && (
          <div className="notification-list">
            <Notification
              type="success"
              content={t('reference_manager_linked')}
            />
          </div>
        )}
        {oauthResult === 'error' && (
          <div className="notification-list">
            <Notification
              type="error"
              content={t('generic_something_went_wrong')}
            />
          </div>
        )}
        {error && (
          <div className="notification-list">
            <Notification type="error" content={error} />
          </div>
        )}
      </div>
      <div>
        {isLinked ? (
          <OLButton
            variant="danger-ghost"
            onClick={() => setShowUnlinkConfirm(true)}
          >
            {t('unlink')}
          </OLButton>
        ) : (
          <OLButton variant="secondary" onClick={handleLink}>
            {t('link_to_mendeley')}
          </OLButton>
        )}
      </div>

      <OLModal
        show={showUnlinkConfirm}
        onHide={() => setShowUnlinkConfirm(false)}
      >
        <OLModalHeader>
          <OLModalTitle>
            {t('unlink_provider_account_title', { provider: 'Mendeley' })}
          </OLModalTitle>
        </OLModalHeader>
        <OLModalBody>{t('unlink_warning_reference')}</OLModalBody>
        <OLModalFooter>
          <OLButton
            variant="secondary"
            onClick={() => setShowUnlinkConfirm(false)}
            disabled={processing}
          >
            {t('cancel')}
          </OLButton>
          <OLButton variant="danger" onClick={handleUnlink} isLoading={processing}>
            {t('unlink')}
          </OLButton>
        </OLModalFooter>
      </OLModal>
    </div>
  )
}

// Hide the Mendeley linking widget when Mendeley is disabled on this instance.
// Named (not default) export: settings' linking-section keys each widget by
// `Object.keys(importObject)[0]`, which would collide on 'default' once a
// second reference manager is registered.
export function MendeleyWidget() {
  const { mendeley } = useInstanceFeatures()
  if (!mendeley) {
    return null
  }
  return <MendeleyWidgetInner />
}
