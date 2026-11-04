import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLNotification from '@/shared/components/ol/ol-notification'
import OLBadge from '@/shared/components/ol/ol-badge'
import MaterialIcon from '@/shared/components/material-icon'
import {
  Dropdown,
  DropdownToggle,
  DropdownMenu,
  DropdownItem,
} from '@/shared/components/dropdown/dropdown-menu'
import '../../stylesheets/llm-settings.scss'
import LLMUsageMeter from './llm-usage-meter' // overleaf-lab (usage meter)
// overleaf-lab: shared upstream-AI design tokens (--wf-*) used by the settings chrome
import '../../stylesheets/llm-ui.scss'

const LLM_API_TYPES = [
  { name: 'openai', label: 'OpenAI' },
  { name: 'anthropic', label: 'Anthropic' },
]

const DEFAULT_SYSTEM_PROMPT = `You are an expert LaTeX debugging assistant and compiler error specialist.

**Your Primary Role - Error Debugging:**
- Analyze LaTeX compilation errors and warnings
- Identify syntax mistakes, missing packages, and structural issues
- Explain errors in beginner-friendly language
- Provide working fixes with clear explanations

**When a user sends a compilation error:**

1. **Quick Summary** (1-2 sentences)
   - What's wrong in plain English

2. **The Problem**
   - Explain the error clearly
   - Point to the exact issue in their code

3. **The Fix**
   - Show corrected code in \`\`\`latex blocks
   - Highlight what changed

4. **Why This Happened**
   - Brief explanation of the root cause
   - How to prevent it in future

**Error Analysis Guidelines:**
- The line marked with → is where the error occurred
- Look at surrounding context for clues
- Common issues: typos in commands, missing packages, unmatched braces
- Check for: \\begin without \\end, missing $, wrong package names

**Also Helpful With:**
- General LaTeX syntax and commands
- Document structure and formatting
- Mathematical typesetting
- Bibliography and citations

**Response Style:**
- Be concise and practical
- Use code blocks for all LaTeX examples
- Assume the user is learning LaTeX
- Focus on solving the immediate problem first

Remember: The user is likely frustrated. Be encouraging and clear!`

// overleaf-lab: a small accessible toggle switch (styled from a button) used for
// the per-feature enable/disable controls.
function ToggleSwitch({
    checked,
    onChange,
    label,
}: {
    checked: boolean
    onChange: (v: boolean) => void
    label?: string
}) {
    return (
        <OLButton
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={() => onChange(!checked)}
            className={`ol-llm-admin-settings__switch${checked ? ' is-on' : ''}`}
        >
            <span
                className="ol-llm-admin-settings__switch-knob"
            />
        </OLButton>
    )
}

export default function LLMAdminSettingsPage() {
    const { t } = useTranslation()
    const hasStoredKey = getMeta('ol-hasLlmApiKey') === 'true'
    // overleaf-lab: true when the shown URL is inherited from the LLM_API_URL env
    // var rather than saved in the admin settings file.
    const apiUrlFromEnv = getMeta('ol-llmApiUrlFromEnv') === 'true'
    const apiTypeFromEnv = getMeta('ol-llmApiTypeFromEnv') === 'true'

    const [systemPrompt, setSystemPrompt] = useState<string>(
        (getMeta('ol-systemPrompt') as string) || DEFAULT_SYSTEM_PROMPT
    )
    const [llmApiUrl, setLlmApiUrl] = useState<string>(
        (getMeta('ol-llmApiUrl') as string) || ''
    )
    const [llmApiType, setLlmApiType] = useState<string>(
        (getMeta('ol-llmApiType') as string) || ''
    )
    const [llmApiKey, setLlmApiKey] = useState<string>('')
    // overleaf-lab: true = the user explicitly asked to REMOVE the stored key
    // (blank input otherwise keeps the stored key).
    const [clearLlmApiKey, setClearLlmApiKey] = useState(false)
    const [allowedModels, setAllowedModels] = useState<string[]>(
        ((getMeta('ol-allowedModels') as string) || '')
            .split(',')
            .map(m => m.trim())
            .filter(Boolean)
    )
    const [availableModels, setAvailableModels] = useState<string[]>([])
    // overleaf-lab: item 8 — the FULL model list found by a scan/test (including
    // unchecked models), persisted so unchecked models stay visible across reloads.
    const [knownModels, setKnownModels] = useState<string[]>(
        ((getMeta('ol-knownModels') as string) || '')
            .split(',')
            .map(m => m.trim())
            .filter(Boolean)
    )
    // overleaf-lab (2026-08-27, owner request): the admin "Inline completion
    // model" and "Review model" pickers and the rubric editor are GONE. Inline
    // completion and the review both run on each user's shared model selection
    // (profile → BYO row → site default), and rubrics live per-user under
    // /user/llm-settings.
    const [maxContextTokens, setMaxContextTokens] = useState<number>(parseInt((getMeta('ol-maxContextTokens') as string) || '32000', 10) || 32000)
    // overleaf-lab: budget for the review's JSON answer (the model's max_tokens and
    // the room reserved for it in the context check).
    const [reviewMaxTokens, setReviewMaxTokens] = useState<number>(parseInt((getMeta('ol-reviewMaxTokens') as string) || '12000', 10) || 12000)
    // overleaf-lab: per-feature enable/disable toggles. The metas use data-type='json'
    // so getMeta returns the parsed boolean; default to true when missing/undefined.
    const [chatEnabled, setChatEnabled] = useState<boolean>(getMeta('ol-chatEnabled') !== false)
    const [completionEnabled, setCompletionEnabled] = useState<boolean>(getMeta('ol-completionEnabled') !== false)
    const [reviewEnabled, setReviewEnabled] = useState<boolean>(getMeta('ol-reviewEnabled') !== false)

    // overleaf-lab: global force-off for the whole AI stack (shared admin settings file).
    const [llmDisabledByAdmin, setLlmDisabledByAdmin] = useState<boolean>(
        getMeta('ol-llmDisabledByAdmin') === 'true'
    )
    // overleaf-lab: editable AI prompts. Empty field means the backend uses its
    // built-in default; promptDefaults feeds the per-field reset buttons.
    const promptDefaults = (getMeta('ol-promptDefaults') as any) || {}
    const [askAiSystemPrompt, setAskAiSystemPrompt] = useState<string>((getMeta('ol-askAiSystemPrompt') as string) || '')
    const [errorPrompt, setErrorPrompt] = useState<string>((getMeta('ol-errorPrompt') as string) || '')
    const [reviewSystemPrompt, setReviewSystemPrompt] = useState<string>((getMeta('ol-reviewSystemPrompt') as string) || '')
    // overleaf-lab (merge phase 4): unified AI assistant (workbench) prompt.
    const [workbenchSystemPrompt, setWorkbenchSystemPrompt] = useState<string>((getMeta('ol-workbenchSystemPrompt') as string) || '')
    const initialActions = (getMeta('ol-askAiActionPrompts') as Record<string, string>) || {}
    const [askAiActionPrompts, setAskAiActionPrompts] = useState<Record<string, string>>(initialActions && typeof initialActions === 'object' ? initialActions : {})
    // overleaf-lab: keep the Ask AI action templates block collapsed by default
    const [showActions, setShowActions] = useState(false)
    const [scanStatus, setScanStatus] = useState<string | null>(null)
    const [testStatus, setTestStatus] = useState<string | null>(null)

    const {
        isLoading: isSaving,
        isSuccess,
        isError,
        error,
        runAsync,
    } = useAsync()

    const [showSuccess, setShowSuccess] = useState(false)
    // F8: surface validation errors returned by the save endpoint (field + message).
    const [saveErrors, setSaveErrors] = useState<string[]>([])
    useEffect(() => {
        if (isSuccess) {
            setShowSuccess(true)
            const timer = setTimeout(() => setShowSuccess(false), 4000)
            return () => clearTimeout(timer)
        }
    }, [isSuccess])

    // overleaf-lab: only the URL and its type are required — a local llama.cpp server has no
    // auth, so scan/test must work with an empty key. The server returns 401 if
    // it actually needs one.
    const canConnect = !!llmApiUrl && !!llmApiType
    const selectedApiType = LLM_API_TYPES.find(t => t.name === llmApiType)

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault()
        setSaveErrors([])
        runAsync(
            postJSON('/admin/llm/settings', {
                body: {
                    systemPrompt,
                    llmApiUrl,
                    llmApiType,
                    llmApiKey,
                    clearLlmApiKey,
                    allowedModels,
                    knownModels,
                    // overleaf-lab (2026-08-27): completionModel / complianceRubrics /
                    // reviewModel no longer sent — see the state block above. Existing
                    // values in the admin settings document simply stop being read by
                    // the lane resolution logic.
                    maxContextTokens,
                    reviewMaxTokens,
                    chatEnabled,
                    completionEnabled,
                    reviewEnabled,
                    llmDisabledByAdmin,
                    askAiSystemPrompt,
                    errorPrompt,
                    reviewSystemPrompt,
                    workbenchSystemPrompt,
                    askAiActionPrompts,
                },
            })
        ).catch((err: any) => {
            // F8: show the specific validation errors when the server returns them.
            const list = Array.isArray(err?.data?.errors)
                ? err.data.errors.map((x: any) => `${x.field}: ${x.message}`)
                : [err?.data?.error || err?.message || t('generic_something_went_wrong', 'Something went wrong')]
            setSaveErrors(list)
        })
    }

    const testConnection = async () => {
        setTestStatus('testing')
        try {
            const resp = await postJSON('/admin/llm/settings/check', {
                body: { apiUrl: llmApiUrl, apiKey: llmApiKey, apiType: llmApiType },
            })
            if (resp.success) {
                setTestStatus('success')
                // overleaf-lab: item 7 — test = model-list fetch: a successful test
                // returns the backend's model list, so adopt it in the same round
                // trip (no separate scan needed).
                if (Array.isArray(resp.models)) {
                    setKnownModels(prev => Array.from(new Set([...prev, ...resp.models])))
                }
            } else {
                setTestStatus('error')
            }
        } catch (e) {
            setTestStatus('error')
        }
    }

    const scanModels = async () => {
        setScanStatus('scanning')
        try {
            const resp = await postJSON('/admin/llm/models', {
                body: {
                    apiUrl: llmApiUrl,
                    apiKey: llmApiKey,
                    apiType: llmApiType,
                },
            })
            if (resp.success && Array.isArray(resp.models)) {
                setAvailableModels(resp.models)
                setScanStatus('success')
                setKnownModels(prev => Array.from(new Set([...prev, ...resp.models])))
                setAllowedModels(prev => {
                    const combined = new Set([...prev, ...resp.models])
                    return Array.from(combined)
                })
            } else {
                setScanStatus('error')
            }
        } catch {
            setScanStatus('error')
        }
    }

    const toggleAllowedModel = (model: string) => {
        setAllowedModels(prev =>
            prev.includes(model)
                ? prev.filter(m => m !== model)
                : [...prev, model]
        )
    }

    /* overleaf-lab (2026-08-27): rubric editing moved to the user settings page
       (/user/llm-settings) — no admin rubric state anymore. */

    const allModels = Array.from(new Set([...knownModels, ...availableModels, ...allowedModels]))

    // overleaf-lab (owner request 2026-08-26): admin page reorganized like the
    // admin/user console — a left sidebar lists the sections, the right column
    // shows the active one (CSS hides the rest via data-active/data-sec).
    const [activeSection, setActiveSection] = useState('features')

    return (
        <div className="container llm-settings ol-llm-admin-settings" data-active={activeSection}>
          {/* Page header */}
          <div className="llm-settings-header">
              <h1 className="llm-settings-header-title">
                  <MaterialIcon type="smart_toy" />
                  {t('llm_configuration', 'LLM Configuration')}
              </h1>
              <p className="llm-settings-header-desc">
                  {t(
                      'llm_admin_description',
                      'Configure the AI assistant for your Overleaf instance. Set up the API connection, choose available models, and customize the system prompt.'
                  )}
              </p>
          </div>

          {/* overleaf-lab: sidebar navigation (admin/user-style layout) */}
          <nav className="llm-admin-sidebar" aria-label={t('llm_admin_sections', 'LLM settings sections')}>
              {[
                  { id: 'features', icon: 'toggle_on', label: t('llm_features', 'Features') },
                  { id: 'connection', icon: 'link', label: t('api_connection', 'API Connection') },
                  { id: 'models', icon: 'model_training', label: t('model_selection', 'Model Selection') },
                  { id: 'prompt', icon: 'description', label: t('system_prompt', 'System Prompt') },
                  { id: 'prompts', icon: 'edit_note', label: t('ai_prompts', 'AI Prompts') },
                  { id: 'availability', icon: 'shield', label: t('services_availability', 'Services (availability)') }, // overleaf-lab (grammar port)
                  { id: 'usage', icon: 'insights', label: t('llm_usage', 'Usage') }, // overleaf-lab (usage meter)
              ].map(s => (
                  <button
                      key={s.id}
                      type="button"
                      role="tab"
                      className={`llm-admin-nav-item${activeSection === s.id ? ' active' : ''}`}
                      aria-current={activeSection === s.id ? 'page' : undefined}
                      onClick={() => setActiveSection(s.id)}
                  >
                      <span aria-hidden="true">
                          <MaterialIcon type={s.icon} className="llm-admin-nav-icon" />
                      </span>
                      {s.label}
                  </button>
              ))}
          </nav>

          <form onSubmit={handleSave} className="llm-admin-content">
              {/* ── Section 1: Features ── */}
              {/* overleaf-lab: master on/off switches per AI feature */}
              <div className="llm-settings-section" data-sec="features">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">1</span>
                      <MaterialIcon type="toggle_on" />
                      {t('llm_features', 'Features')}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'llm_features_desc',
                          'Enable or disable each AI feature for all users. A disabled feature cannot be used by anyone, even with their own API key.'
                      )}
                  </p>

                  <div className="llm-settings-section-body">
                      {/* overleaf-lab: one toggle switch per feature */}
                      {[
                          { key: 'chat', on: chatEnabled, set: setChatEnabled, title: t('feature_chat', 'Chat'), help: t('feature_chat_help', 'The AI assistant (workbench): chat, tools and its history. Ask AI on selection keeps working independently.') },
                          { key: 'completion', on: completionEnabled, set: setCompletionEnabled, title: t('feature_completion', 'Inline completion'), help: t('feature_completion_help', 'Autocomplete suggestions while typing.') },
                          { key: 'review', on: reviewEnabled, set: setReviewEnabled, title: t('feature_review', 'Compliance review'), help: t('feature_review_help', 'The whole-document review.') },
                      ].map(f => (
                          <div
                              key={f.key}
                              className="ol-llm-admin-settings__feature-row"
                          >
                              <div>
                                  <span className="ol-llm-admin-settings__feature-title">{f.title}</span>
                                  <OLFormText className="ol-llm-admin-settings__no-margin">{f.help}</OLFormText>
                              </div>
                              <ToggleSwitch checked={f.on} onChange={f.set} label={f.title} />
                          </div>
                      ))}
                  </div>
              </div>

              {/* ── Section 2: API Connection ── */}
              <div className="llm-settings-section" data-sec="connection">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">2</span>
                      <MaterialIcon type="link" />
                      {t('api_connection', 'API Connection')}
                      {testStatus === 'success' && (
                          <OLBadge bg="success" className="ol-llm-admin-settings__connected-badge">
                              {t('connected', 'Connected')}
                          </OLBadge>
                      )}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'api_connection_desc',
                          'Enter the endpoint URL and API key for your OpenAI-compatible LLM provider.'
                      )}
                  </p>

                  <OLFormGroup controlId="llm-api-url">
                      <OLFormLabel>
                          {t('llm_api_url', 'API Endpoint URL')}
                      </OLFormLabel>
                      <OLFormControl
                          type="url"
                          value={llmApiUrl}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              setLlmApiUrl(e.target.value)
                          }
                          placeholder="https://api.example.com/v1"
                      />
                      {apiUrlFromEnv && (
                          <OLFormText>
                              <MaterialIcon type="info" className="me-1 ol-llm-admin-settings__icon-sm"  />
                              {t('llm_admin_from_env', 'Inherited from the LLM_API_URL environment variable. Saving here stores it in the admin settings file.')}
                          </OLFormText>
                      )}
                  </OLFormGroup>

                  <OLFormGroup controlId="llm-api-type">
                      <OLFormLabel>
                          {t('llm_api_type', 'API Type')}
                      </OLFormLabel>
                      <div>
                      <Dropdown>
                          <DropdownToggle
                            id="llm-api-type-dropdown"
                            className="btn-secondary"
                            aria-label="Select LLM API type"
                          >
                            <span className="text-truncate" aria-hidden>
                              {selectedApiType?.label ?? 'Select API type'}
                            </span>
                          </DropdownToggle>

                          <DropdownMenu flip={false}>
                            {LLM_API_TYPES.map(apiType => (
                              <DropdownItem
                                key={apiType.name}
                                active={apiType.name === llmApiType}
                                onClick={() => setLlmApiType(apiType.name)}
                              >
                                {apiType.label}
                              </DropdownItem>
                            ))}
                          </DropdownMenu>
                      </Dropdown>
                      </div>

                      {apiTypeFromEnv && (
                          <OLFormText>
                            <MaterialIcon
                              type="info"
                              className="me-1 ol-llm-admin-settings__icon-sm"
                            />
                            {t(
                              'llm_type_from_env',
                              'Inherited from the LLM_API_TYPE environment variable. Saving here stores it in the admin settings file.'
                            )}
                          </OLFormText>
                      )}
                  </OLFormGroup>

                  <OLFormGroup controlId="llm-api-key" className="ol-llm-admin-settings__mb-lg">
                      <OLFormLabel>
                          {t('llm_api_key', 'API Key')}
                      </OLFormLabel>
                      <OLFormControl
                          type="password"
                          value={llmApiKey}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              setLlmApiKey(e.target.value)
                              // overleaf-lab: typing a new key cancels a pending "remove"
                              if (e.target.value) {
                                  setClearLlmApiKey(false)
                              }
                          }}
                          placeholder={
                              hasStoredKey
                                  ? t('llm_api_key_placeholder_stored', '••••••••  (stored — leave blank to keep)')
                                  : t('llm_api_key_placeholder', 'Paste your API key here')
                          }
                      />
                      {hasStoredKey && !llmApiKey && (
                          <OLFormText>
                              <MaterialIcon type="check_circle" className="me-1 ol-llm-admin-settings__ok-green"  />
                              {t('llm_api_key_stored', 'An API key is already stored. Leave blank to keep it.')}
                          </OLFormText>
                      )}
                      <OLFormText>
                          <MaterialIcon type="info" className="me-1 ol-llm-admin-settings__icon-sm"  />
                          {t('llm_api_key_optional_local', 'Leave blank for a local server with no auth (e.g. a llama.cpp server).')}
                      </OLFormText>
                      {hasStoredKey && (
                          <OLButton
                              variant="link"
                              onClick={() => {
                                  setLlmApiKey('')
                                  setClearLlmApiKey(true)
                              }}
                          >
                              {t('llm_api_key_remove', 'Remove stored key')}
                          </OLButton>
                      )}
                  </OLFormGroup>

                  <div className="ol-llm-admin-settings__row-inline">
                      <OLButton
                          variant="secondary"
                          size="sm"
                          type="button"
                          onClick={testConnection}
                          disabled={!canConnect}
                          isLoading={testStatus === 'testing'}
                      >
                          <MaterialIcon type="cable" className="me-1 ol-llm-admin-settings__icon-base"  />
                          {t('test_connection', 'Test Connection')}
                      </OLButton>
                      {testStatus === 'success' && (
                          <span className="llm-settings-section-status llm-settings-section-status-success">
                              <MaterialIcon type="check_circle" className="llm-settings-section-status-icon" />
                              {t('connection_successful', 'Connection successful')}
                          </span>
                      )}
                      {testStatus === 'error' && (
                          <span className="llm-settings-section-status llm-settings-section-status-error">
                              <MaterialIcon type="error" className="llm-settings-section-status-icon" />
                              {t('connection_failed', 'Connection failed — check URL and key')}
                          </span>
                      )}
                  </div>
              </div>

              {/* ── Section 3: Model Selection ── */}
              <div className="llm-settings-section" data-sec="models">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">3</span>
                      <MaterialIcon type="model_training" />
                      {t('model_selection', 'Model Selection')}
                      {allModels.length > 0 && (
                          <span className="ol-llm-admin-settings__model-count">
                              {allowedModels.filter(m => allModels.includes(m)).length}/{allModels.length} {t('selected', 'selected')}
                          </span>
                      )}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'model_selection_desc',
                          'Scan the API for available models, then choose which ones users can access.'
                      )}
                  </p>

                  <div
                      className={`ol-llm-admin-settings__row-inline${allModels.length > 0 ? ' ol-llm-admin-settings__mt-lg' : ''}`}
                  >
                      <OLButton
                          variant="secondary"
                          size="sm"
                          type="button"
                          onClick={scanModels}
                          disabled={!canConnect}
                          isLoading={scanStatus === 'scanning'}
                      >
                          <MaterialIcon type="radar" className="me-1 ol-llm-admin-settings__icon-base"  />
                          {t('scan_for_models', 'Scan for Models')}
                      </OLButton>
                      {scanStatus === 'success' && (
                          <span className="llm-settings-section-status llm-settings-section-status-success">
                              <MaterialIcon type="check_circle" className="llm-settings-section-status-icon" />
                              {t('scan_found_models', `Found ${availableModels.length} model(s)`)}
                          </span>
                      )}
                      {scanStatus === 'error' && (
                          <span className="llm-settings-section-status llm-settings-section-status-error">
                              <MaterialIcon type="error" className="llm-settings-section-status-icon" />
                              {t('scan_failed', 'Scan failed — check connection first')}
                          </span>
                      )}
                      {!canConnect && scanStatus === null && (
                          <span className="ol-llm-admin-settings__small">
                              {t('configure_api_first', 'Configure the API connection above first')}
                          </span>
                      )}
                  </div>

                  {allModels.length > 0 && (
                      <>
                          <div className="ol-llm-admin-settings__model-list">
                              {allModels.map((model) => (
                                  <label
                                      key={model}
                                      className="ol-llm-admin-settings__model-row"
                                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-light-secondary, #f8f9fa)' }}
                                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '' }}
                                  >
                                      <input
                                          type="checkbox"
                                          checked={allowedModels.includes(model)}
                                          onChange={() => toggleAllowedModel(model)}
                                          className="ol-llm-admin-settings__model-checkbox"
                                      />
                                      <span className="ol-llm-admin-settings__mono-lg">
                                          {model}
                                      </span>
                                  </label>
                              ))}
                          </div>
                          <div className="ol-llm-admin-settings__models-actions">
                              <OLButton
                                  variant="link"
                                  size="sm"
                                  type="button"
                                  onClick={() => setAllowedModels([...allModels])}
                                  className="ol-llm-admin-settings__link-btn"
                              >
                                  {t('select_all', 'Select all')}
                              </OLButton>
                              <span className="ol-llm-admin-settings__muted">|</span>
                              <OLButton
                                  variant="link"
                                  size="sm"
                                  type="button"
                                  onClick={() => setAllowedModels([])}
                                  className="ol-llm-admin-settings__link-btn"
                              >
                                  {t('unselect_all', 'Unselect all')}
                              </OLButton>
                          </div>
                      </>
                  )}

                  {/* overleaf-lab (2026-08-27, owner request): the admin
                      "Inline completion model" picker is GONE — inline
                      completion runs on each user's shared model selection
                      (profile -> first BYO row -> site default), managed by
                      users in File -> "Select LLM Model" and their BYO rows. */}
              </div>

              {/* ── Section 4: System Prompt ── */}
              <div className="llm-settings-section" data-sec="prompt">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">4</span>
                      <MaterialIcon type="description" />
                      {t('system_prompt', 'System Prompt')}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'system_prompt_desc',
                          'This prompt is prepended to every AI conversation. Use it to customize the assistant\'s behavior for your organization.'
                      )}
                  </p>

                  <OLFormGroup controlId="llm-system-prompt" className="ol-llm-admin-settings__mb-sm">
                      <OLFormControl
                          as="textarea"
                          rows={12}
                          value={systemPrompt}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                              setSystemPrompt(e.target.value)
                          }
                          placeholder={t(
                              'llm_system_prompt_placeholder',
                              'You are a helpful LaTeX assistant...'
                          )}
                          maxLength={4000}
                          className="ol-llm-admin-settings__mono"
                      />
                  </OLFormGroup>
                  <div className="ol-llm-admin-settings__row-between">
                      <OLFormText className="ol-llm-admin-settings__no-margin">
                          {systemPrompt.length}/4000 {t('characters', 'characters')}
                      </OLFormText>
                      <OLButton
                          variant="link"
                          size="sm"
                          type="button"
                          onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                          className="ol-llm-admin-settings__link-btn"
                      >
                          <MaterialIcon type="restart_alt" className="me-1 ol-llm-admin-settings__icon-base"  />
                          {t('reset_to_default', 'Reset to default')}
                      </OLButton>
                  </div>
              </div>

              {/* overleaf-lab (2026-08-27, owner request): the former admin
                  Compliance Review section (rubric editor + Review model picker)
                  is GONE. Rubrics are USER-SCOPED now: each user configures
                  their own under /user/llm-settings; the reviewer reads the
                  user's rubrics, inheriting the deployment-wide set until the
                  user saves their own. The review runs on the user's shared
                  model selection (profile -> BYO row -> site default), the
                  same as every other AI surface. The review's token budgets
                  moved to Section 5 (AI Prompts). */}

              {/* ── Section 6: AI Prompts ── */}
              {/* overleaf-lab: editable prompts behind each AI feature; empty means built-in default */}
              <div className="llm-settings-section" data-sec="prompts">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">5</span>
                      <MaterialIcon type="edit_note" />
                      {t('ai_prompts', 'AI Prompts')}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'ai_prompts_desc',
                          'Customize the prompts and token budgets behind each AI feature. Leave a field empty to use the built-in default.'
                      )}
                  </p>

                  {/* overleaf-lab (2026-08-27): the compliance review's token budgets
                      moved here from the former admin Compliance Review section.
                      These are DEPLOYMENT budgets — the review runs each user's
                      own rubrics (user settings), but the context window and the
                      answer budget are site-wide. */}
                  <OLFormGroup controlId="llm-max-context-tokens" className="ol-llm-admin-settings__mt-md">
                      <OLFormLabel>
                          {t('max_context_tokens', 'Review: max context tokens')}
                      </OLFormLabel>
                      <OLFormControl
                          type="number"
                          value={maxContextTokens}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const parsed = parseInt(e.target.value, 10)
                              if (!isNaN(parsed)) {
                                  setMaxContextTokens(parsed)
                              }
                          }}
                      />
                      <OLFormText>
                          {t(
                              'max_context_tokens_help',
                              'The context window (in tokens) of the review model, as configured on your backend. The review refuses documents that would not fit. No auto-detection.'
                          )}
                      </OLFormText>
                  </OLFormGroup>

                  <OLFormGroup controlId="llm-review-max-tokens" className="ol-llm-admin-settings__mt-lg-mb-0">
                      <OLFormLabel>
                          {t('review_max_tokens', 'Review answer budget (tokens)')}
                      </OLFormLabel>
                      <OLFormControl
                          type="number"
                          value={reviewMaxTokens}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const parsed = parseInt(e.target.value, 10)
                              if (!isNaN(parsed)) {
                                  setReviewMaxTokens(parsed)
                              }
                          }}
                      />
                      <OLFormText>
                          {t(
                              'review_max_tokens_help',
                              'Upper limit for the answer of each review pass. The actual room adapts to what the document leaves free inside Max context tokens, so a large value here never blocks a long document; it only allows more thorough per-requirement analyses when there is room.'
                          )}
                      </OLFormText>
                  </OLFormGroup>

                  {/* overleaf-lab: (a) the three standalone prompts, each with a reset link */}
                  {[
                      {
                          key: 'askAiSystemPrompt',
                          value: askAiSystemPrompt,
                          set: setAskAiSystemPrompt,
                          def: promptDefaults.askAiSystemPrompt,
                          label: t('ask_ai_behavior_prompt', 'Ask AI behavior prompt'),
                          help: t('ask_ai_behavior_prompt_help', 'System prompt for the selection toolbar (Ask AI / paraphrase / rewrite).'),
                      },
                      {
                          key: 'errorPrompt',
                          value: errorPrompt,
                          set: setErrorPrompt,
                          def: promptDefaults.errorPrompt,
                          label: t('error_help_prompt', 'Error help prompt'),
                          help: t('error_help_prompt_help', 'Instructions appended when a user clicks Ask AI about a compile error.'),
                      },
                      {
                          key: 'reviewSystemPrompt',
                          value: reviewSystemPrompt,
                          set: setReviewSystemPrompt,
                          def: promptDefaults.reviewSystemPrompt,
                          label: t('review_system_prompt', 'Review system prompt'),
                          help: t('review_system_prompt_help', 'System prompt for the whole-document compliance review.'),
                      },
                      {
                          key: 'workbenchSystemPrompt',
                          value: workbenchSystemPrompt,
                          set: setWorkbenchSystemPrompt,
                          def: promptDefaults.workbenchSystemPrompt,
                          label: t('assistant_system_prompt', 'AI assistant system prompt'),
                          help: t(
                              'assistant_system_prompt_help',
                              'System prompt of the unified AI assistant in the workbench (chat, tools, editing). The language and LaTeX-formatting rules live here; keep it neutral — no example languages.'
                          ),
                      },
                  ].map(field => (
                      <div key={field.key} className="ol-llm-admin-settings__mb-xl">
                          <OLFormGroup controlId={`llm-${field.key}`} className="ol-llm-admin-settings__mb-xs">
                              <OLFormLabel>
                                  {field.label}
                              </OLFormLabel>
                              <OLFormControl
                                  as="textarea"
                                  rows={6}
                                  value={field.value}
                                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                      field.set(e.target.value)
                                  }
                                  className="ol-llm-admin-settings__mono"
                              />
                          </OLFormGroup>
                          <div className="ol-llm-admin-settings__row-between">
                              <OLFormText className="ol-llm-admin-settings__no-margin">
                                  {field.help}
                              </OLFormText>
                              <OLButton
                                  variant="link"
                                  size="sm"
                                  type="button"
                                  onClick={() => field.set(field.def || '')}
                                  className="ol-llm-admin-settings__link-btn"
                              >
                                  <MaterialIcon type="restart_alt" className="me-1 ol-llm-admin-settings__icon-base"  />
                                  {t('reset_to_default', 'Reset to default')}
                              </OLButton>
                          </div>
                      </div>
                  ))}

                  {/* overleaf-lab: (b) collapsible Ask AI action templates, one textarea per action */}
                  <div className="ol-llm-admin-settings__mt-sm">
                      <OLButton
                          variant="link"
                          size="sm"
                          type="button"
                          onClick={() => setShowActions(v => !v)}
                          className="ol-llm-admin-settings__small-md"
                      >
                          <MaterialIcon type={showActions ? 'expand_less' : 'expand_more'} className="me-1 ol-llm-admin-settings__icon-lg"  />
                          {t('ask_ai_action_templates', 'Ask AI action templates')}
                      </OLButton>

                      {showActions && (
                          <div className="ol-llm-admin-settings__mt-md">
                              <OLFormText className="ol-llm-admin-settings__help-before">
                                  {t(
                                      'ask_ai_action_help',
                                      'Each template runs on the selected text. Use {{selection}} where the selected text should be inserted; if omitted, it is appended.'
                                  )}
                              </OLFormText>
                              {/* overleaf-lab (audit #7): only the templates the current Ask AI menu actually uses —
                                  punchy/split/join/summarize/explain/mathFix/checkCitations were removed with the
                                  menu rebuild, and title/abstract now flow through the generators endpoint. */}
                              {['paraphrase', 'academic', 'concise', 'translate', 'synonyms'].map(key => (
                                  <div key={key} className="ol-llm-admin-settings__mb-lg">
                                      <OLFormGroup controlId={`llm-action-${key}`} className="ol-llm-admin-settings__mb-xs">
                                          <OLFormLabel>
                                              {t(`ask_ai_action_${key}`, key.charAt(0).toUpperCase() + key.slice(1))}
                                          </OLFormLabel>
                                          <OLFormControl
                                              as="textarea"
                                              rows={4}
                                              value={askAiActionPrompts[key] || ''}
                                              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                                                  const value = e.target.value
                                                  setAskAiActionPrompts(prev => ({ ...prev, [key]: value }))
                                              }}
                                              className="ol-llm-admin-settings__mono"
                                          />
                                      </OLFormGroup>
                                      <div className="ol-llm-admin-settings__row-end">
                                          <OLButton
                                              variant="link"
                                              size="sm"
                                              type="button"
                                              onClick={() => {
                                                  const def = promptDefaults.askAiActionPrompts?.[key] || ''
                                                  setAskAiActionPrompts(prev => ({ ...prev, [key]: def }))
                                              }}
                                              className="ol-llm-admin-settings__link-btn"
                                          >
                                              <MaterialIcon type="restart_alt" className="me-1 ol-llm-admin-settings__icon-base"  />
                                              {t('reset_to_default', 'Reset to default')}
                                          </OLButton>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>

              {/* overleaf-lab: Section 6 — availability (global force-off). */}
              <div className="llm-settings-section" data-sec="availability">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">6</span>
                      <MaterialIcon type="shield" />
                      {t('services_availability', 'Services (availability)')}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'services_availability_desc',
                          'Force the AI off for every user, even when configured (shared or personal BYO).'
                      )}
                  </p>

                  <div className="llm-settings-section-body">
                      <div className="ol-llm-admin-settings__feature-row">
                          <input
                              type="checkbox"
                              id="llm-disabled-by-admin"
                              checked={llmDisabledByAdmin}
                              onChange={e => setLlmDisabledByAdmin(e.target.checked)}
                              style={{ marginRight: '0.5rem' }}
                          />
                          <label htmlFor="llm-disabled-by-admin">
                              {t('llm_disabled_by_admin', 'Disable LLM for all users (force off, even BYO)')}
                          </label>
                      </div>
                  </div>
              </div>

              {/* ── Notifications ── */}
              {showSuccess && (
                  <div className="ol-llm-admin-settings__mb-lg">
                      <OLNotification
                          type="success"
                          content={t('llm_settings_saved', 'LLM settings saved successfully.')}
                      />
                  </div>
              )}
              {isError && (
                  <div className="ol-llm-admin-settings__mb-lg">
                      <OLNotification
                          type="error"
                          content={
                              (error as any)?.message ??
                              t('generic_something_went_wrong', 'Something went wrong')
                          }
                      />
                  </div>
              )}

              {/* ── Section 7: Usage (usage meter) — read-only, placed above the save button ── */}
              <div className="llm-settings-section" data-sec="usage">
                  <div className="llm-settings-section-header">
                      <span className="llm-settings-section-badge">7</span>
                      <MaterialIcon type="insights" />
                      {t('llm_usage', 'Usage')}
                  </div>
                  <p className="llm-settings-section-desc">
                      {t(
                          'llm_usage_desc',
                          'Token usage across the whole site (all users, site and personal connections). Data comes from real model responses and is updated after each request.'
                      )}
                  </p>
                  <LLMUsageMeter scope="admin" />
              </div>

              {/* ── Save Button ── */}
              {saveErrors.length > 0 && (
                  <OLNotification type="error" content={saveErrors.join(' · ')} />
              )}
              <OLButton
                  variant="primary"
                  type="submit"
                  disabled={isSaving}
                  isLoading={isSaving}
                  loadingLabel={t('saving') + '…'}
                  className="ol-llm-admin-settings__save-btn"
              >
                  <MaterialIcon type="save" className="me-1 ol-llm-admin-settings__icon-lg"  />
                  {t('save_settings', 'Save Settings')}
              </OLButton>
          </form>
        </div>
    )
}
