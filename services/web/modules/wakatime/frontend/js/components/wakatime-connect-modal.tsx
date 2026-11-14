import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { putJSON } from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'

const DEFAULT_API_URL = 'https://wakatime.com/api/v1'

export default function WakaTimeConnectModal({
  show,
  handleHide,
  onLinked,
}: {
  show: boolean
  handleHide: () => void
  onLinked: () => void
}) {
  const { t } = useTranslation()
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [apiKey, setApiKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setIsSaving(true)
    setError(null)

    try {
      await putJSON('/user/wakatime', {
        body: { apiUrl: apiUrl.trim() || DEFAULT_API_URL, apiKey: apiKey.trim() },
      })
      setApiKey('')
      onLinked()
      handleHide()
    } catch (err: any) {
      setError(
        err?.data?.message ||
          err?.message ||
          t('generic_something_went_wrong')
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <OLModal show={show} onHide={handleHide} backdrop="static">
      <form onSubmit={handleSubmit}>
        <OLModalHeader closeButton>
          <OLModalTitle>{t('connect_wakatime', { defaultValue: 'Connect WakaTime' })}</OLModalTitle>
        </OLModalHeader>

        <OLModalBody>
          <p className="small">
            {t('wakatime_connect_description', {
              defaultValue:
                'For wakatime.com: open https://wakatime.com/oauth while logged in and copy your personal OAuth token (API keys are write-only for IDE plugins). For a self-hosted Wakapi server: paste its API key and API URL below.',
            })}
          </p>

          <OLFormGroup controlId="wakatime-api-url">
            <OLFormLabel>{t('api_url', { defaultValue: 'API URL' })}</OLFormLabel>
            <OLFormControl
              type="text"
              value={apiUrl}
              placeholder={DEFAULT_API_URL}
              onChange={e => setApiUrl(e.target.value)}
            />
          </OLFormGroup>

          <OLFormGroup controlId="wakatime-api-key">
            <OLFormLabel>
              {t('api_key_or_oauth_token', { defaultValue: 'API key / OAuth token' })}
            </OLFormLabel>
            <OLFormControl
              type="password"
              value={apiKey}
              required
              autoComplete="off"
              onChange={e => setApiKey(e.target.value)}
            />
          </OLFormGroup>

          {error && <Notification type="error" content={error} />}
        </OLModalBody>

        <OLModalFooter>
          <OLButton variant="secondary" onClick={handleHide} disabled={isSaving}>
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            type="submit"
            disabled={isSaving || !apiKey.trim()}
          >
            {isSaving ? t('saving') : t('connect', { defaultValue: 'Connect' })}
          </OLButton>
        </OLModalFooter>
      </form>
    </OLModal>
  )
}
