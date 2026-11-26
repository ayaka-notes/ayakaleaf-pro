// overleaf-lab: shared "Select LLM Model" dialog (owner request 2026-08-25).
// The single place where the deployment-wide model choice is made; the value
// drives Chat, Review, all AI Generate items and the ask-AI context menu.
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OLModal } from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import { useLLMModelSelection } from '../hooks/use-llm-model-selection'
import '../../stylesheets/llm-ui.scss'

interface LLMModelSelectModalProps {
    show: boolean
    onHide: () => void
}

const LLMModelSelectModal = React.memo(function LLMModelSelectModal({
    show,
    onHide,
}: LLMModelSelectModalProps) {
    const { t } = useTranslation()
    // overleaf-lab (owner request 2026-08-26): the "Deployment default" pseudo
    // option is gone — only concrete models (site + BYO rows) are selectable.
    const { options, loaded, selected, tasks, apply } = useLLMModelSelection()
    const [local, setLocal] = useState('')
    // overleaf-lab (2026-11): per-task model selection. '' = shared default
    // (applies to every task); the other keys override ONE surface.
    const TASKS: Array<{ key: string; label: string }> = [
        { key: '', label: t('llm_task_default', 'All tasks (default)') },
        { key: 'chat', label: t('llm_task_chat', 'Chat (AI Assistant)') },
        { key: 'completion', label: t('llm_task_completion', 'Inline completion') },
        { key: 'review', label: t('llm_task_review', 'Compliance review') },
        { key: 'error', label: t('llm_task_error', 'Error analysis (suggest fix)') },
        { key: 'vision', label: t('llm_task_vision', 'Attachments (PDF/PNG)') },
    ] as const
    const [task, setTask] = useState('')

    const currentForTask = task
        ? (tasks[task] || selected || (loaded ? options[0]?.value || '' : ''))
        : (selected || (loaded ? options[0]?.value || '' : ''))

    // Re-seed each time the modal opens or the task changes (and live if
    // another surface changed the selection while it is open). When nothing is
    // selected yet, preselect the first concrete model (site default) so
    // "Use this model" always picks a real model.
    useEffect(() => {
        if (show) setLocal(currentForTask)
    }, [show, task, currentForTask])

    const save = () => {
        apply(local, task || undefined)
        onHide()
    }

    return (
        <OLModal
            show={show}
            onHide={onHide}
            aria-label={t('llm_select_model', 'Select LLM Model')}
        >
            <div className="modal-header">
                <h5 className="modal-title">
                    <MaterialIcon type="model_training" className="me-2" />
                    {t('llm_select_model', 'Select LLM Model')}
                </h5>
                <button
                    type="button"
                    className="btn-close"
                    onClick={onHide}
                    aria-label={t('close', 'Close')}
                />
            </div>
            <div className="modal-body">
                {/* overleaf-lab (2026-11, owner request): "a table above apply to
                    with which model is applied to the different topics".
                    Per-task assignment overview: override > default > site.
                    Read-only — the picker below does the changing. */}
                {loaded && (
                    <div
                        className="llm-model-tasks-table"
                        role="region"
                        aria-label={t('llm_model_by_task', 'Model per task')}
                    >
                        <table
                            className="table table-sm llm-model-tasks"
                            style={{ margin: '0', fontSize: '0.85rem' }}
                        >
                            <thead>
                                <tr>
                                    <th scope="col">{t('llm_task_col', 'Task')}</th>
                                    <th scope="col">{t('llm_model_col', 'Model applied')}</th>
                                    <th scope="col">{t('llm_provider_col', 'Provider')}</th>
                                    <th scope="col">{t('llm_source_col', 'Source')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {TASKS.filter(o => o.key).map(o => {
                                    const fallback = selected || options[0]?.value || ''
                                    const model = tasks[o.key] || fallback
                                    const overridden = !!tasks[o.key]
                                    const rowModel = options.find(m => m.value === model)
                                    const provider = rowModel?.provider || rowModel?.rowName || ''
                                    return (
                                        <tr key={o.key} data-task={o.key}>
                                            <td>{o.label}</td>
                                            <td>
                                                <code>{model || t('llm_not_set', 'not set')}</code>
                                            </td>
                                            <td>{provider}</td>
                                            <td>
                                                {overridden
                                                    ? t('llm_src_override', 'your override')
                                                    : selected
                                                      ? t('llm_src_default', 'your default')
                                                      : t('llm_src_site', 'site default')}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                <div className="llm-model-task-picker">
                    <label htmlFor="llm-task-select">
                        {t('llm_task_label', 'Apply to')}
                    </label>
                    <select
                        id="llm-task-select"
                        value={task}
                        onChange={e => setTask(e.target.value)}
                    >
                        {TASKS.map(o => (
                            <option key={o.key || 'default'} value={o.key}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </div>
                <p className="llm-model-hint">
                    {task
                        ? t(
                            'llm_select_model_hint_task',
                            'This model is used ONLY for the selected task. All other tasks keep the default model. The choice is saved to your profile and follows you across projects.',
                        )
                        : t(
                            'llm_select_model_hint',
                            'This model is used everywhere — AI Assistant chat, Review, the AI Generate menu items and ask-AI on selected text. The choice is saved to your profile and follows you across projects.',
                        )}
                </p>
                {task && (tasks[task] || '') !== '' && (
                    <p className="llm-model-hint llm-model-hint-override">
                        {t(
                            'llm_select_model_task_override_active',
                            'A task-specific model is currently configured. Use "All tasks (default)" to change or reset the default.',
                        )}
                    </p>
                )}
                <div className="llm-model-option-list" role="radiogroup">
                    {options.map(o => (
                        <label
                            key={o.value || 'default'}
                            className={`llm-model-option${local === o.value ? ' selected' : ''}`}
                        >
                            <input
                                type="radio"
                                name="llm-select-model"
                                value={o.value}
                                checked={local === o.value}
                                onChange={() => setLocal(o.value)}
                            />
                            <span className="llm-model-option-body">
                                <span className="llm-model-option-label">
                                    {o.label}
                                </span>
                                {/* overleaf-lab (2026-11): always show the
                                    provider — several providers can serve the
                                    same model name (Site vs BYO rows). */}
                                {(o.provider || o.rowName) && (
                                    <span className="llm-model-option-row">
                                        {o.provider || o.rowName}
                                    </span>
                                )}
                            </span>
                        </label>
                    ))}
                    {!loaded && (
                        <div className="llm-model-option loading">
                            {t('llm_loading', 'Loading…')}
                        </div>
                    )}
                </div>
            </div>
            <div className="modal-footer">
                <OLButton variant="secondary" onClick={onHide}>
                    {t('cancel', 'Cancel')}
                </OLButton>
                <OLButton variant="primary" onClick={save} disabled={!loaded}>
                    {t('llm_apply_model', 'Use this model')}
                </OLButton>
            </div>
        </OLModal>
    )
})

export default LLMModelSelectModal
