import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import UsersActionModal from './users-action-modal'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import { useRefWithAutoFocus } from '@/shared/hooks/use-ref-with-auto-focus'
import { getAdditionalUserInfo, getAiUsage, resetAiUsage, type AiUsage } from '../../util/api'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import type { User } from '../../../../../types/user/api'


type UpdateUserModalProps = Pick<
  React.ComponentProps<typeof UsersActionModal>,
  'users' | 'actionHandler' | 'showModal' | 'handleCloseModal'
>
const pickUserFields = ({ id, firstName, lastName, email, isAdmin, features, aiFeatures }: User) => ({
  id, firstName, lastName, email, isAdmin,
  aiFeatures: { enabled: aiFeatures?.enabled !== false },
  features: {
    collaborators: features?.collaborators,
    compileTimeout: features?.compileTimeout,
  }
})

function UserBasicInfoTab({ userData, handleTextChange, handleCheckboxChange, allowUpdateDetails, allowUpdateIsAdmin, isSelf }) {
  const { t } = useTranslation()
  const { autoFocusedRef } = useRefWithAutoFocus<HTMLInputElement>()

  return (
    <>
      <OLFormGroup controlId="id-">
        <OLFormLabel>{t('ID')}</OLFormLabel>
        <OLFormControl
          ref={autoFocusedRef}
          maxLength="128"
          autoComplete="off"
          type="text"
          name="id"
          onChange={handleTextChange}
          value={userData.id}
          disabled={true}
        />
      </OLFormGroup>
      <OLFormGroup controlId="email-address">
        <OLFormLabel>{t('email_address')}</OLFormLabel>
        <OLFormControl
          maxLength="128"
          autoComplete="off"
          type="text"
          name="email"
          onChange={handleTextChange}
          value={userData.email}
        />
      </OLFormGroup>
      <OLFormGroup controlId="first-name">
        <OLFormLabel>{t('first_name')}</OLFormLabel>
        <OLFormControl
          maxLength="128"
          autoComplete="off"
          type="text"
          name="firstName"
          onChange={handleTextChange}
          value={userData.firstName}
          disabled={!allowUpdateDetails}
        />
      </OLFormGroup>
      <OLFormGroup controlId="last-name">
        <OLFormLabel>{t('last_name')}</OLFormLabel>
        <OLFormControl
          maxLength="128"
          autoComplete="off"
          type="text"
          name="lastName"
          onChange={handleTextChange}
          value={userData.lastName}
          disabled={!allowUpdateDetails}
        />
      </OLFormGroup>
      <OLRow>
        <OLCol xs={6}>
          <OLFormGroup controlId="is-admin-checkbox">
            <OLFormCheckbox
              autoComplete="off"
              onChange={handleCheckboxChange}
              name="isAdmin"
              label={"Set as admin"}
              checked={userData.isAdmin}
              disabled={isSelf || !allowUpdateIsAdmin}
            />
          </OLFormGroup>
        </OLCol>
      </OLRow>
    </>
  )
}

function UserPasswordTab({
  userData,
  handleTextChange,
  activationLink,
  onGeneratePassword,
}: {
  userData: any
  handleTextChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  activationLink: string | null
  onGeneratePassword: () => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <p>You can also manually set a new password for the user.</p>
      <OLFormGroup controlId="password">
        <OLFormLabel>{t('new_password')}</OLFormLabel>
        <OLFormControl
          name="password"
          type="password"
          placeholder="*********"
          autoComplete="off"
          value={userData.password || ''}
          onChange={handleTextChange}
          minLength={8}
          append={
            <button
              type="button"
              className="form-control-search-clear-btn"
              aria-label="Generate password"
              title="Generate password"
              onClick={onGeneratePassword}
            >
              <MaterialIcon type="refresh" />
            </button>
          }
        />
      </OLFormGroup>
      <hr />
      <p>
        You can also manually send them URLs below to allow them to reset their
        password and log in for the first time.
        <br />
        The password reset link or randomly generated password is below:
      </p>
      <div className="git-bridge-copy">
        <code>{activationLink}</code>
        <span>
          <CopyToClipboard content={activationLink} kind="text" />
        </span>
      </div>
    </>
  )
}

function UserFeaturesTab({
  userData,
  handleFeatureNumChange,
  autoFocusedRef,
}: {
  userData: any
  handleFeatureNumChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  autoFocusedRef: React.Ref<HTMLInputElement>
}) {
  return (
    <>
      <OLFormGroup controlId="compileTimeout">
        <OLFormLabel>Compile Timeout (In second, no more than 300s)</OLFormLabel>
        <OLFormControl
          ref={autoFocusedRef}
          autoComplete="off"
          type="number"
          name="compileTimeout"
          onChange={handleFeatureNumChange}
          value={userData.features?.compileTimeout || ''}
          min={1}
          max={300}
          step={1}
        />
      </OLFormGroup>
      <OLFormGroup controlId="collaborators">
        <OLFormLabel>Collaborator limit (use -1 for unlimited)</OLFormLabel>
        <OLFormControl
          ref={autoFocusedRef}
          autoComplete="off"
          type="number"
          name="collaborators"
          onChange={handleFeatureNumChange}
          value={userData.features?.collaborators || ''}
          min={-1}
          step={1}
        />
      </OLFormGroup>
    </>
  )
}

function AiUsageControls({ userId }: { userId: string }) {
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  useEffect(() => {
    let active = true
    getAiUsage(userId).then(data => {
      if (active) setUsage(data)
    }).catch(() => {
      if (active) setStatus('error')
    })
    return () => { active = false }
  }, [userId])

  const reset = async () => {
    setStatus('loading')
    try {
      setUsage(await resetAiUsage(userId))
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="d-flex align-items-center gap-3">
      <span>
        {usage
          ? `Usage: ${usage.used?.toLocaleString() ?? '—'} / Limit: ${usage.limit?.toLocaleString() ?? 'Unlimited'} tokens`
          : status === 'error' ? 'Usage unavailable' : 'Loading usage…'}
      </span>
      <OLButton variant="secondary" type="button" onClick={reset} disabled={status === 'loading' || !usage}>
        {status === 'loading' ? 'Resetting…' : 'Reset'}
      </OLButton>
      {status === 'done' && <span role="status">Done</span>}
      {status === 'error' && <span role="alert">Please try again.</span>}
    </div>
  )
}

function UpdateUserModal({
  users,
  actionHandler,
  showModal,
  handleCloseModal,
}: UpdateUserModalProps) {
  const { t } = useTranslation()
  const { autoFocusedRef } = useRefWithAutoFocus<HTMLInputElement>()
  const [activeTab, setActiveTab] = useState('basic-info')

  if (users.length !== 1) return null
  const [userData, setUserData] = useState<ReturnType<typeof pickUserFields> & { password?: string }>(pickUserFields(users[0]))
  const isSelf = getMeta('ol-user_id') === users[0].id
  const allowUpdateDetails = users[0].allowUpdateDetails
  const allowUpdateIsAdmin = users[0].allowUpdateIsAdmin
  const [activationLink, setActivationLink] = useState<string | null>(null)

  useEffect(() => {
    if (showModal) {
      setUserData(pickUserFields(users[0]))
      setActiveTab('basic-info')

      getAdditionalUserInfo(users[0].id)
        .then(({ activationLink }) => {
          setActivationLink(activationLink)
        })
        .catch(() => {
          setActivationLink(null)
        })
    }
  }, [showModal, users])

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.currentTarget
    setUserData(prev => ({ ...prev, [name]: value }))
  }

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.currentTarget
    setUserData(prev => ({ ...prev, [name]: checked }))
  }

  const handleAiAccessChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.currentTarget.checked
    setUserData(prev => ({ ...prev, aiFeatures: { enabled } }))
  }

  const handleFeatureNumChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.currentTarget
    const numberValue = parseInt(value, 10)
    if (!isNaN(numberValue)) {
      setUserData(prev => ({
        ...prev,
        features: {
          ...prev.features,
          [name]: numberValue,
        },
      }))
    }
  }

  const generatePassword = () => {
    const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
    const length = 12
    const values = new Uint32Array(length)
    window.crypto.getRandomValues(values)

    let password = ''
    for (let i = 0; i < length; i++) {
      password += PASSWORD_CHARS[values[i] % PASSWORD_CHARS.length]
    }
    setUserData(prev => ({ ...prev, password }))
    setActivationLink(password)
  }

  return (
    <UsersActionModal
      action="update"
      actionHandler={actionHandler}
      title={t('update_account_info')}
      showModal={showModal}
      handleCloseModal={handleCloseModal}
      users={users}
      options={{ userData }}
    >
      <div className="ol-tabs">
        <div className="nav-tabs-container">
          <ul className="nav nav-tabs align-left" role="tablist">
            <li className="nav-item" role="presentation">
              <a
                className={`nav-link ${activeTab === 'basic-info' ? 'active' : ''}`}
                href="#basic-info"
                role="tab"
                onClick={(e) => {
                  e.preventDefault()
                  setActiveTab('basic-info')
                }}
              >
                {t('info')}
              </a>
            </li>
            <li className="nav-item" role="presentation">
              <a
                className={`nav-link ${activeTab === 'password' ? 'active' : ''}`}
                href="#permissions"
                role="tab"
                onClick={(e) => {
                  e.preventDefault()
                  setActiveTab('password')
                }}
              >
                {t('password')}
              </a>
            </li>
            <li className="nav-item" role="presentation">
              <a
                className={`nav-link ${activeTab === 'features' ? 'active' : ''}`}
                href="#features"
                role="tab"
                onClick={(e) => {
                  e.preventDefault()
                  setActiveTab('features')
                }}
              >
                {t('features')}
              </a>
            </li>
            <li className="nav-item" role="presentation">
              <a
                className={`nav-link ${activeTab === 'ai' ? 'active' : ''}`}
                href="#user-ai-settings"
                role="tab"
                aria-selected={activeTab === 'ai'}
                aria-controls="user-ai-settings"
                onClick={event => {
                  event.preventDefault()
                  setActiveTab('ai')
                }}
              >
                {t('ai_features')}
              </a>
            </li>
          </ul>
        </div>

        <div className="tab-content">
          <div className={`tab-pane ${activeTab === 'basic-info' ? 'active' : ''}`} role="tabpanel" id="basic-info">
            <UserBasicInfoTab
              userData={userData}
              handleTextChange={handleTextChange}
              handleCheckboxChange={handleCheckboxChange}
              allowUpdateDetails={allowUpdateDetails}
              allowUpdateIsAdmin={allowUpdateIsAdmin}
              isSelf={isSelf}
            />
          </div>

          <div className={`tab-pane ${activeTab === 'password' ? 'active' : ''}`} role="tabpanel" id="permissions">
            <UserPasswordTab
              userData={userData}
              handleTextChange={handleTextChange}
              activationLink={activationLink}
              onGeneratePassword={generatePassword}
            />
          </div>

          <div className={`tab-pane ${activeTab === 'features' ? 'active' : ''}`} role="tabpanel" id="features">
            <UserFeaturesTab
              userData={userData}
              handleFeatureNumChange={handleFeatureNumChange}
              autoFocusedRef={autoFocusedRef}
            />
          </div>
          <div className={`tab-pane ${activeTab === 'ai' ? 'active' : ''}`} role="tabpanel" id="user-ai-settings">
            <OLFormGroup controlId="user-ai-enabled">
              <OLFormCheckbox
                name="aiEnabled"
                label={t('enable_ai_features')}
                checked={userData.aiFeatures.enabled}
                onChange={handleAiAccessChange}
              />
            </OLFormGroup>
            {showModal && activeTab === 'ai' && <AiUsageControls key={userData.id} userId={userData.id} />}
          </div>
        </div>
      </div>
    </UsersActionModal>
  )
}

export default UpdateUserModal
