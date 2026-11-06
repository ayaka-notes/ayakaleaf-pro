// overleaf-lab (2026-08-27, owner request): USER-SCOPED compliance review
// rubrics, rendered on the /user/llm-settings page. The reviewer checks the
// user's document against the rubrics this user defines (owning the policy is
// personal — a thesis student and a lab group use different rules).
//
// Backend (LLMSettingsController.getUserCompliance/saveUserCompliance):
//   GET  /user/llm/compliance          -> { ok, rubrics: [full rubrics], inherited }
//   POST /user/llm/compliance          body: { rubrics: [...] }
// A user who has never saved their own rubrics inherits the deployment-wide
// set (admin default); saving makes the list personal.
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLNotification from '@/shared/components/ol/ol-notification'
import MaterialIcon from '@/shared/components/material-icon'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'

interface ComplianceRubric {
    id: string
    name: string
    guidelines: string
    scanPatterns?: string
}

export default function LLMComplianceSettings() {
    const { t } = useTranslation()
    const { isReady } = useWaitForI18n()
    const [rubrics, setRubrics] = useState<ComplianceRubric[]>([])
    const [inherited, setInherited] = useState(false)
    const [loaded, setLoaded] = useState(false)
    const [disabled, setDisabled] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    const load = useCallback(() => {
        getJSON<{ ok?: boolean; rubrics?: ComplianceRubric[]; inherited?: boolean }>(
            '/user/llm/compliance',
        )
            .then(data => {
                setRubrics(Array.isArray(data?.rubrics) ? data.rubrics : [])
                setInherited(!!data?.inherited)
                setLoaded(true)
            })
            .catch((err: any) => {
                // 403 'disabled' = the review feature is off on this deployment;
                // any other failure just shows the empty state.
                if (err?.data?.error === 'disabled' || err?.statusCode === 403) {
                    setDisabled(true)
                }
                setLoaded(true)
            })
    }, [])

    useEffect(() => {
        if (isReady) load()
    }, [isReady, load])

    const addRubric = () => {
        const id = `rubric-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        setRubrics(prev => [...prev, { id, name: '', guidelines: '', scanPatterns: '' }])
    }

    const updateRubric = (id: string, field: 'name' | 'guidelines' | 'scanPatterns', value: string) => {
        setRubrics(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)))
    }

    const removeRubric = (id: string) => {
        setRubrics(prev => prev.filter(r => r.id !== id))
    }

    const save = () => {
        setSaveError(null)
        setSaving(true)
        setSaved(false)
        postJSON('/user/llm/compliance', { body: { rubrics } })
            .then(data => {
                setRubrics(Array.isArray(data?.rubrics) ? data.rubrics : rubrics)
                setInherited(false)
                setSaving(false)
                setSaved(true)
                setTimeout(() => setSaved(false), 4000)
            })
            .catch((err: any) => {
                setSaving(false)
                setSaveError(err?.data?.message || err?.message || t('save_failed', 'Saving failed'))
            })
    }

    const resetToInherited = () => load()

    if (!loaded) {
        return <p className="ol-llm-admin-settings__muted-md">{t('loading', 'Loading…')}</p>
    }

    if (disabled) {
        return (
            <p className="ol-llm-admin-settings__muted-md">
                {t(
                    'compliance_disabled',
                    'The compliance review feature is disabled on this deployment.',
                )}
            </p>
        )
    }

    return (
        <div className="llm-compliance-settings">
            <p className="ol-llm-admin-settings__muted-md">
                {t(
                    'compliance_rubrics_user_help',
                    'The compliance review checks your document against the rubrics below. These are yours, per profile — you can define the exact guidelines (numbered or bulleted requirements) and optional mechanical scan patterns. Until you save your own, you use the deployment defaults below.',
                )}
            </p>

            {inherited && (
                <div className="ol-llm-admin-settings__mb-lg">
                    <OLNotification
                        type="info"
                        content={t(
                            'compliance_inherited',
                            'Showing the deployment defaults. Edit anything or add a rubric and save to make this set your own.',
                        )}
                    />
                </div>
            )}

            {rubrics.length === 0 && (
                <p className="ol-llm-admin-settings__muted-md">
                    {t(
                        'compliance_no_rubrics_user',
                        'No rubrics yet — the compliance review stays disabled until you add one.',
                    )}
                </p>
            )}

            {rubrics.map(rubric => (
                <div key={rubric.id} className="ol-llm-admin-settings__rubric-card">
                    <div className="ol-llm-admin-settings__row-end">
                        <OLButton
                            variant="link"
                            size="sm"
                            type="button"
                            onClick={() => removeRubric(rubric.id)}
                        >
                            <MaterialIcon type="delete" className="me-1 ol-llm-admin-settings__icon-base" />
                            {t('remove_rubric', 'Remove rubric')}
                        </OLButton>
                    </div>
                    <OLFormGroup controlId={`llm-user-rubric-name-${rubric.id}`}>
                        <OLFormLabel>{t('rubric_name', 'Rubric name')}</OLFormLabel>
                        <OLFormControl
                            type="text"
                            value={rubric.name}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                updateRubric(rubric.id, 'name', e.target.value)
                            }
                            placeholder={t('rubric_name_placeholder', 'e.g. Thesis writing guidelines')}
                        />
                    </OLFormGroup>
                    <OLFormGroup controlId={`llm-user-rubric-guidelines-${rubric.id}`} className="ol-llm-admin-settings__mb-sm">
                        <OLFormLabel>{t('rubric_guidelines', 'Guidelines')}</OLFormLabel>
                        <OLFormControl
                            as="textarea"
                            rows={6}
                            value={rubric.guidelines}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                updateRubric(rubric.id, 'guidelines', e.target.value)
                            }
                            className="ol-llm-admin-settings__mono"
                        />
                    </OLFormGroup>
                    <OLFormGroup controlId={`llm-user-rubric-scans-${rubric.id}`} className="ol-llm-admin-settings__mb-sm">
                        <OLFormLabel>{t('rubric_scan_patterns', 'Scan patterns (optional, one per line)')}</OLFormLabel>
                        <OLFormControl
                            as="textarea"
                            rows={3}
                            value={rubric.scanPatterns || ''}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                                updateRubric(rubric.id, 'scanPatterns', e.target.value)
                            }
                            placeholder={'First person :: (?<![\\w.@/])(io|noi|ho)\\b\nWikipedia :: wikipedia'}
                            className="ol-llm-admin-settings__mono"
                        />
                        <OLFormText>
                            {t(
                                'rubric_scan_patterns_help',
                                '"Label :: regex" (case-insensitive; a plain word works too). The reviewer scans the whole document for matches and only then asks the model to judge each hit — exhaustive mechanical checks plus contextual judgement for the pattern-like requirements of THIS rubric.',
                            )}
                        </OLFormText>
                    </OLFormGroup>
                </div>
            ))}

            <div className="ol-llm-admin-settings__row-end ol-llm-admin-settings__mt-lg">
                <OLButton size="sm" variant="secondary" type="button" onClick={addRubric}>
                    <MaterialIcon type="add" className="me-1 ol-llm-admin-settings__icon-base" />
                    {t('add_rubric', 'Add rubric')}
                </OLButton>
                <span className="ol-llm-admin-settings__spacer-sm" />
                <OLButton size="sm" variant="secondary" type="button" onClick={resetToInherited}>
                    <MaterialIcon type="restart_alt" className="me-1 ol-llm-admin-settings__icon-base" />
                    {t('reset_to_defaults', 'Reset to deployment defaults')}
                </OLButton>
                <OLButton size="sm" variant="secondary" type="button" onClick={save} disabled={saving} isLoading={saving}>
                    <MaterialIcon type="save" className="me-1 ol-llm-admin-settings__icon-base" />
                    {t('save_settings', 'Save my rubrics')}
                </OLButton>
            </div>

            {saved && (
                <div className="ol-llm-admin-settings__mt-md">
                    <OLNotification type="success" content={t('compliance_saved', 'Your rubrics are saved and now personal.')} />
                </div>
            )}
            {saveError && (
                <div className="ol-llm-admin-settings__mt-md">
                    <OLNotification type="error" content={saveError} />
                </div>
            )}
        </div>
    )
}
