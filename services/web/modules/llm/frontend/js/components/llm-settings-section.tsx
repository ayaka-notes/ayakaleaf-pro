import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLNotification from '@/shared/components/ol/ol-notification'
import OLBadge from '@/shared/components/ol/ol-badge'

// overleaf-lab: BYO (bring-your-own) LLM provider table.
//
// Users manage their own LLM endpoints here: one row per provider with
// type, base URL, encrypted API key, the models it may serve, and an
// optional inline-completion model. Add / edit / delete rows, test the
// connection, and scan the backend for served models.
//
// Backend: /user/llm-providers* (LLMSettingsController). Credentials are
// encrypted at rest (LLM_KEY_SECRET) and never returned to the browser.

type ProviderRow = {
    id: string
    name: string
    providerType: 'openai' | 'anthropic' | 'openaiCompatible'
    baseUrl: string
    hasKey: boolean
    models: string[]
    completionModel: string
    enabled: boolean
    createdAt?: string
}

type Draft = {
    isNew: boolean
    id: string
    name: string
    providerType: 'openai' | 'anthropic' | 'openaiCompatible'
    baseUrl: string
    apiKey: string
    keepKey: boolean
    models: string[]
    completionModel: string
    enabled: boolean
    storedKey: boolean
}

type Notice = { type: 'success' | 'error'; text: string } | null

function defaultDraft(): Draft {
    return {
        isNew: true,
        id: '',
        name: '',
        providerType: 'openaiCompatible',
        baseUrl: '',
        apiKey: '',
        keepKey: false,
        models: [],
        completionModel: '',
        enabled: true,
        storedKey: false,
    }
}

function draftFromRow(row: ProviderRow): Draft {
    return {
        isNew: false,
        id: row.id,
        name: row.name,
        providerType: row.providerType,
        baseUrl: row.baseUrl || '',
        apiKey: '',
        keepKey: true,
        models: [...row.models],
        completionModel: row.completionModel || '',
        enabled: row.enabled,
        storedKey: row.hasKey,
    }
}

const PROVIDER_TYPE_LABELS: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    openaiCompatible: 'OpenAI-compatible (Ollama, vLLM, llama.cpp, ...)',
}

export default function LLMSettingsSection({ compact = false }: { compact?: boolean } = {}) {
    // overleaf-lab: when embedded inside the core Account Settings page (reviewer
    // #2) the surrounding page already provides context, so the standalone
    // header is skipped there.

    const { t } = useTranslation()
    const [providers, setProviders] = useState<ProviderRow[]>([])
    const [maxProviders, setMaxProviders] = useState(10)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [draft, setDraft] = useState<Draft | null>(null)
    const [modelInput, setModelInput] = useState('')
    const [busy, setBusy] = useState<string | null>(null)
    const [notice, setNotice] = useState<Notice>(null)
    const [testResult, setTestResult] = useState<Notice>(null)

    const flash = (next: Notice) => {
        setNotice(next)
        if (next) {
            setTimeout(() => setNotice(null), 6000)
        }
    }

    const load = useCallback(async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const response = await getJSON('/user/llm-providers')
            setProviders(Array.isArray(response.providers) ? response.providers : [])
            setMaxProviders(typeof response.maxProviders === 'number' ? response.maxProviders : 10)
        }
        catch (err: any) {
            setLoadError(err?.message || 'Failed to load your LLM providers')
            setProviders([])
        }
        finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        load()
    }, [load])

    const canAdd = providers.length < maxProviders

    const openAdd = () => {
        if (!canAdd) return
        setTestResult(null)
        setModelInput('')
        setDraft(defaultDraft())
    }

    const openEdit = (row: ProviderRow) => {
        setTestResult(null)
        setModelInput('')
        setDraft(draftFromRow(row))
    }

    const closeDraft = () => {
        setDraft(null)
        setModelInput('')
        setTestResult(null)
    }

    const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        setDraft((d) => (d ? { ...d, [key]: value } : d))
    }

    const addModel = () => {
        const ids = modelInput
            .split(/[\s,]+/)
            .map((m) => m.trim())
            .filter((m) => m.length > 0)
        setDraft((d) => {
            if (!d) return d
            const models = Array.from(new Set([...d.models, ...ids]))
            const completionModel = d.completionModel || (models[0] || '')
            return { ...d, models, completionModel }
        })
        setModelInput('')
    }

    const removeModel = (id: string) => {
        setDraft((d) => {
            if (!d) return d
            const models = d.models.filter((m) => m !== id)
            const completionModel =
                d.completionModel === id ? '' : d.completionModel
            return { ...d, models, completionModel }
        })
    }

    const validate = (d: Draft): string | null => {
        if (!d.name.trim()) return t('llm_byo_err_name', 'Please enter a provider name')
        if (d.models.length === 0) return t('llm_byo_err_models', 'Please add at least one model')
        if (d.providerType === 'openaiCompatible' && !d.baseUrl.trim()) {
            return t('llm_byo_err_url', 'A base URL is required for OpenAI-compatible providers')
        }
        if (d.completionModel && !d.models.includes(d.completionModel)) {
            return t('llm_byo_err_completion', 'The completion model must be one of the listed models')
        }
        return null
    }

    const save = async () => {
        if (!draft) return
        const problem = validate(draft)
        if (problem) {
            flash({ type: 'error', text: problem })
            return
        }
        setBusy('save')
        try {
            const payload: Record<string, unknown> = {
                name: draft.name.trim(),
                providerType: draft.providerType,
                baseUrl: draft.baseUrl.trim(),
                models: draft.models,
                completionModel: draft.completionModel,
                enabled: draft.enabled,
            }
            if (draft.isNew) {
                if (draft.apiKey.trim()) {
                    payload.apiKey = draft.apiKey.trim()
                }
                await postJSON('/user/llm-providers', { body: payload })
            }
            else {
                if (draft.apiKey.trim()) {
                    payload.apiKey = draft.apiKey.trim()
                }
                else if (!draft.keepKey) {
                    payload.clearApiKey = true
                }
                await postJSON(`/user/llm-providers/${draft.id}`, { body: payload })
            }
            flash({
                type: 'success',
                text: t('llm_byo_saved', 'Provider saved. It is now available in the editor.'),
            })
            closeDraft()
            await load()
        }
        catch (err: any) {
            flash({ type: 'error', text: err?.data?.message || err?.data?.details || err?.message || t('llm_byo_save_failed', 'Saving failed') })
        }
        finally {
            setBusy(null)
        }
    }

    const testDraft = async () => {
        if (!draft) return
        setTestResult(null)
        setBusy('test')
        const body: Record<string, unknown> = {
            baseUrl: draft.baseUrl.trim(),
            providerType: draft.providerType,
            models: draft.models,
        }
        if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim()
        if (!draft.isNew && draft.keepKey) body.rowId = draft.id
        const firstModel = draft.models[0]
        if (firstModel) body.model = firstModel
        try {
            const response = await postJSON('/user/llm-providers/check', { body })
            // overleaf-lab (reviewer #5): the backend auto-detects the working API
            // type — persist it on the row, or switch the draft so the saved type is right.
            let autoTypeText = ''
            if (response.detectedProviderType && response.detectedProviderType !== draft.providerType) {
                const detected = response.detectedProviderType as string
                if (draft.id) {
                    try {
                        await postJSON(`/user/llm-providers/${draft.id}`, { body: { providerType: detected } })
                    }
                    catch { /* row update is best-effort; the connection test itself passed */ }
                }
                else {
                    setDraft((d) => (d ? { ...d, providerType: detected } : d))
                }
                autoTypeText = t('llm_byo_auto_type', ' — API type auto-set to {{type}}', { type: PROVIDER_TYPE_LABELS[detected] || detected })
            }
            setTestResult({
                type: 'success',
                text: `${response.message || t('llm_byo_test_ok', 'Connection successful')}${
                    Array.isArray(response.models)
                        ? ` — ${response.models.length} model(s) served`
                        : ''
                }${autoTypeText}`,
            })
        }
        catch (err: any) {
            setTestResult({ type: 'error', text: err?.data?.message || err?.data?.details || err?.message || t('llm_byo_test_fail', 'Connection failed') })
        }
        finally {
            setBusy(null)
        }
    }

    const scanModels = async () => {
        if (!draft) return
        setBusy('scan')
        const body: Record<string, unknown> = {
            baseUrl: draft.baseUrl.trim(),
            providerType: draft.providerType,
        }
        if (draft.apiKey.trim()) body.apiKey = draft.apiKey.trim()
        if (!draft.isNew && draft.keepKey) body.rowId = draft.id
        try {
            const response = await postJSON('/user/llm-providers/scan', { body })
            const found: string[] = Array.isArray(response.models) ? response.models : []
            // overleaf-lab (reviewer #5): auto-detected type wins for the draft too.
            if (response.detectedProviderType && response.detectedProviderType !== draft.providerType) {
                const detected = response.detectedProviderType as string
                setDraft((d) => (d ? { ...d, providerType: detected } : d))
            }
            if (found.length === 0) {
                flash({ type: 'error', text: t('llm_byo_scan_none', 'The backend reported no models') })
            }
            setDraft((d) => {
                if (!d) return d
                const models = Array.from(new Set([...d.models, ...found]))
                const completionModel = d.completionModel || models[0] || ''
                return { ...d, models, completionModel }
            })
            flash({ type: 'success', text: t('llm_byo_scan_ok', 'Models added to the row') })
        }
        catch (err: any) {
            flash({ type: 'error', text: err?.data?.message || err?.data?.details || err?.message || t('llm_byo_scan_failed', 'Model scan failed') })
        }
        finally {
            setBusy(null)
        }
    }

    const removeProvider = async (row: ProviderRow) => {
        if (!window.confirm(t('llm_byo_delete_confirm', 'Delete this provider and its stored API key?'))) {
            return
        }
        setBusy(`delete-${row.id}`)
        try {
            await postJSON(`/user/llm-providers/${row.id}/delete`, { body: {} })
            if (draft && draft.id === row.id) {
                closeDraft()
            }
            flash({ type: 'success', text: t('llm_byo_deleted', 'Provider deleted') })
            await load()
        }
        catch (err: any) {
            flash({ type: 'error', text: err?.data?.message || err?.data?.details || err?.message || t('llm_byo_delete_failed', 'Delete failed') })
        }
        finally {
            setBusy(null)
        }
    }

    const providerTypeLabel = (type: string) =>
        t(`llm_byo_type_${type === 'openaiCompatible' ? 'compatible' : type}`, PROVIDER_TYPE_LABELS[type] || type)

    return (
        <div className="llm-settings llm-buo">
            {!compact && (
            <div className="llm-settings-header">
                <p className="llm-settings-header-desc">
                    {t(
                        'llm_byo_desc',
                        'Use your own OpenAI, Anthropic, or any OpenAI-compatible endpoint (Ollama, vLLM, llama.cpp, ...). Keys are encrypted on this server and used only for calls you start.'
                    )}
                </p>
            
            </div>
            )}

            {notice && (
                <OLNotification type={notice.type} content={notice.text}
                />
            )}

            {loadError && (
                <OLNotification type="error" content={loadError} />
            )}

            {/* Provider table */}
            {!loading && providers.length > 0 && (
                <div className="llm-buo-table-wrap">
                    <table className="llm-buo-table">
                        <thead>
                            <tr>
                                <th>{t('llm_byo_col_provider', 'Provider')}</th>
                                <th>{t('llm_byo_col_models', 'Models')}</th>
                                <th>{t('llm_byo_col_key', 'Key')}</th>
                                <th>{t('llm_byo_col_status', 'Status')}</th>
                                <th className="llm-buo-actions-col">
                                    {t('llm_byo_col_actions', 'Actions')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {providers.map((row) => (
                                <tr key={row.id}>
                                    <td>
                                        <div className="llm-buo-name">
                                            {row.name}
                                        </div>
                                        <div className="llm-buo-sub">{providerTypeLabel(row.providerType)}</div>
                                    </td>
                                    <td>
                                        <div className="llm-buo-models">
                                            {row.models.slice(0, 3).map((m) => (
                                                <OLBadge key={m} variant={m === row.completionModel && row.completionModel ? 'primary' : 'secondary'}>
                                                    {m}
                                                </OLBadge>
                                            ))}
                                            {row.models.length > 3 && (
                                                <span className="llm-buo-more">
                                                    +{row.models.length - 3}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td>{row.hasKey ? '••••' : '—'}</td>
                                    <td>
                                        {row.enabled
                                            ? t('llm_byo_enabled', 'Enabled')
                                            : t('llm_byo_disabled', 'Disabled')}
                                    </td>
                                    <td className="llm-buo-actions">
                                        <OLButton
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => openEdit(row)}
                                        >
                                            {t('llm_byo_edit', 'Edit')}
                                        </OLButton>{' '}
                                        <OLButton
                                            variant="secondary"
                                            size="sm"
                                            disabled={busy !== null}
                                            onClick={() => removeProvider(row)}
                                        >
                                            {t('llm_byo_delete', 'Delete')}
                                        </OLButton>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!loading && providers.length === 0 && !loadError && (
                <div className="llm-buo-empty">
                    {t(
                        'llm_byo_empty',
                        'You have no LLM providers yet. Add one below to chat, complete, and generate with your own keys.'
                    )}
                </div>
            )}

            {!loading && canAdd && !draft && (
                <OLButton variant="secondary" onClick={openAdd}>
                    {t('llm_byo_add', 'Add provider')}
                </OLButton>
            )}

            {/* Add / edit panel */}
            {draft && (
                <div className="llm-buo-editor">
                    <h2 className="llm-buo-editor-title">
                        {draft.isNew
                            ? t('llm_byo_add', 'Add provider')
                            : t('llm_byo_edit', 'Edit provider')}
                    </h2>

                    <OLFormGroup>
                        <OLFormLabel htmlFor="llm-buo-name">
                            {t('llm_byo_name', 'Name')}
                        </OLFormLabel>
                        <OLFormControl
                            id="llm-buo-name"
                            type="text"
                            value={draft.name}
                            maxLength={80}
                            placeholder={t('llm_byo_name_placeholder', 'e.g. Ollama (lab)')}
                            onChange={(e) => setField('name', e.target.value)}
                        />
                    </OLFormGroup>

                    <OLFormGroup>
                        <OLFormLabel htmlFor="llm-buo-type">
                            {t('llm_byo_provider', 'Provider type')}
                        </OLFormLabel>
                        {/* Native select: OLFormControl (react-bootstrap Form.Control)
                            always renders an <input>, so a select element with
                            <option> children is a void-element violation (dev) /
                            React #137 "got: input" (prod). */}
                        <select
                            id="llm-buo-type"
                            className="form-select"
                            value={draft.providerType}
                            onChange={(e) =>
                                setField('providerType', e.target.value as Draft['providerType'])
                            }
                        >
                            {(['openai', 'anthropic', 'openaiCompatible'] as const).map((type) => (
                                <option key={type} value={type}>
                                    {providerTypeLabel(type)}
                                </option>
                            ))}
                        </select>
                        <OLFormText variant="text">
                            {draft.providerType === 'openai'
                                ? t('llm_byo_openai_hint', 'Uses api.openai.com unless you set a base URL.')
                                : draft.providerType === 'anthropic'
                                    ? t('llm_byo_anthropic_hint', 'Uses api.anthropic.com unless you set a base URL.')
                                    : t('llm_byo_compatible_hint', 'Any server with an OpenAI-style /v1 API: Ollama, vLLM, llama.cpp, OpenRouter, ...')}
                        </OLFormText>
                    </OLFormGroup>

                    <OLFormGroup>
                        <OLFormLabel htmlFor="llm-buo-url">
                            {t('llm_byo_baseurl', 'Base URL')}
                            {draft.providerType === 'openaiCompatible' && (
                                <span className="llm-buo-required">*</span>
                            )}
                        </OLFormLabel>
                        <OLFormControl
                            id="llm-buo-url"
                            type="url"
                            value={draft.baseUrl}
                            placeholder={
                                draft.providerType === 'anthropic'
                                    ? 'https://api.anthropic.com'
                                    : 'http://localhost:11434/v1'
                            }
                            onChange={(e) => setField('baseUrl', e.target.value)}
                        />
                    </OLFormGroup>

                    <OLFormGroup>
                        <OLFormLabel htmlFor="llm-buo-key">
                            {t('llm_byo_key', 'API key')}
                        </OLFormLabel>
                        <OLFormControl
                            id="llm-buo-key"
                            type="password"
                            autoComplete="off"
                            value={draft.apiKey}
                            placeholder={
                                draft.storedKey
                                    ? t('llm_byo_key_keep', 'Stored key present — leave blank to keep it')
                                    : t('llm_byo_key_new', 'Your API key (left blank for keyless local servers)')
                            }
                            onChange={(e) => setField('apiKey', e.target.value)}
                        />
                        {!draft.isNew && draft.storedKey && (
                            <div className="llm-buo-keytoggle">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={draft.keepKey}
                                        onChange={(e) => setField('keepKey', e.target.checked)}
                                    />{' '}
                                    {t('llm_byo_key_keep_check', 'Keep the stored key')}
                                </label>
                            </div>
                        )}
                    </OLFormGroup>

                    <OLFormGroup>
                        <OLFormLabel>
                            {t('llm_byo_models', 'Models')}
                        </OLFormLabel>
                        <div className="llm-buo-model-editor">
                            <OLFormControl
                                type="text"
                                value={modelInput}
                                placeholder={t('llm_byo_model_placeholder', 'qwen3.8:latest, gpt-4o, ...')}
                                onChange={(e) => setModelInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault()
                                        addModel()
                                    }
                                }}
                            />
                            <OLButton variant="secondary" onClick={addModel}>
                                {t('llm_byo_model_add', 'Add')}
                            </OLButton>
                            <OLButton
                                variant="secondary"
                                disabled={busy !== null}
                                onClick={scanModels}
                            >
                                {busy === 'scan'
                                    ? t('llm_byo_scanning', 'Scanning...')
                                    : t('llm_byo_scan', 'Scan backend for models')}
                            </OLButton>
                        </div>
                        {draft.models.length > 0 && (
                            <div className="llm-buo-model-chips">
                                {draft.models.map((m) => (
                                    <span key={m} className="llm-buo-chip">
                                        {m}
                                        <button
                                            type="button"
                                            className="llm-buo-chip-x"
                                            aria-label={t('llm_byo_model_remove', 'Remove model')}
                                            onClick={() => removeModel(m)}
                                        >
                                            ×
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                        {draft.models.length > 0 && (
                            <OLFormText variant="text">
                                {t('llm_byo_models_note', 'The first model is the default for this provider. Highlighted model = inline completion.')}
                            </OLFormText>
                        )}
                    </OLFormGroup>

                    {draft.models.length > 0 && (
                        <OLFormGroup>
                            <OLFormLabel htmlFor="llm-buo-completion">
                                {t('llm_byo_completion_model', 'Inline completion model (optional)')}
                            </OLFormLabel>
                            <select
                                id="llm-buo-completion"
                                className="form-select"
                                value={draft.completionModel}
                                onChange={(e) => setField('completionModel', e.target.value)}
                            >
                                <option value="">
                                    {t('llm_byo_completion_default', 'Use the first listed model')}
                                </option>
                                {draft.models.map((m) => (
                                    <option key={m} value={m}>
                                        {m}
                                    </option>
                                ))}
                            </select>
                        </OLFormGroup>
                    )}

                    <div className="llm-buo-enabled">
                        <label>
                            <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(e) => setField('enabled', e.target.checked)}
                            />{' '}
                            {t('llm_byo_enabled_label', 'Enabled (visible in the editor)')}
                        </label>
                    </div>

                    {testResult && (
                        <OLNotification type={testResult.type} content={testResult.text} />
                    )}

                    <div className="llm-buo-editor-actions">
                        <OLButton
                            variant="primary"
                            disabled={busy !== null}
                            onClick={save}
                        >
                            {busy === 'save'
                                ? t('llm_byo_saving', 'Saving...')
                                : t('llm_byo_save', 'Save provider')}
                        </OLButton>{' '}
                        <OLButton
                            variant="secondary"
                            disabled={busy !== null}
                            onClick={testDraft}
                        >
                            {busy === 'test'
                                ? t('llm_byo_testing', 'Testing...')
                                : t('llm_byo_test', 'Test connection')}
                        </OLButton>{' '}
                        <OLButton variant="secondary" onClick={closeDraft}>
                            {t('llm_byo_cancel', 'Cancel')}
                        </OLButton>
                    </div>
                </div>
            )}
        </div>
    )
}
