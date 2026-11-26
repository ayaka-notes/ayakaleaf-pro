// overleaf-lab: File-menu LLM commands:
//  - "Select LLM Model" (smart_toy) — the ONE and ONLY model selection entry
//    point (owner request 2026-08-26); opens the shared modal; the choice is
//    user-scoped (profile) and drives every AI surface.
//  - AI Generate (Title/Abstract/Keywords, in the INSERT menu) —
//    overleaf-lab (owner request 2026-08-26): automatic again — clicking a
//    generator item immediately runs it with the currently selected model
//    (no per-generation model picker / Generate button, no implicit lane:
//    the model is whatever the user made the shared selection).
//
// (reviewer #13 origin: whole-document generators read the whole project —
// LLMChatController.generateDocument.)
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { postJSON } from '@/infrastructure/fetch-json'
import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import { OLModal } from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import LLMModelSelectModal from '../components/llm-model-select-modal'
// overleaf-lab: upstream-AI design tokens for the generator modal's result surface
import '../../stylesheets/llm-ui.scss'

type GenerateKind = 'title' | 'abstract' | 'keywords'
type Phase = 'busy' | 'result' | 'error'

const KINDS: GenerateKind[] = ['title', 'abstract', 'keywords']

// Submenu item labels — short, Download-style ("AI Generate → Title/Abstract/Keywords").
const MENU_LABEL: Record<GenerateKind, string> = {
    title: 'Title',
    abstract: 'Abstract',
    keywords: 'Keywords',
}

// Modal headings — descriptive.
const KIND_LABEL: Record<GenerateKind, string> = {
    title: 'Generate title for this document',
    abstract: 'Generate an abstract for this document',
    keywords: 'Generate keywords for this document',
}

export default function LLMFileMenuCommands() {
    const { t } = useTranslation()
    const { isReady } = useWaitForI18n()
    const [kind, setKind] = useState<GenerateKind | null>(null)
    // overleaf-lab (owner request 2026-08-26): the File → "Select LLM Model"
    // modal lives here (this component mounts in the menubar tree via
    // menubarExtraComponents).
    const [modelModalOpen, setModelModalOpen] = useState(false)
    const [phase, setPhase] = useState<Phase>('busy')
    const [output, setOutput] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    // overleaf-lab (owner request 2026-08-26): auto-run — a menu click starts
    // the generation immediately with the shared (user-scoped) selection that
    // the backend resolves from the user profile; no model picker in the
    // modal anymore.
    const start = useCallback((asKind: GenerateKind) => {
        setKind(asKind)
        setPhase('busy')
        setError(null)
        setOutput('')
        setCopied(false)
    }, [])

    const close = useCallback(() => {
        setKind(null)
        setPhase('busy')
        setError(null)
        setOutput('')
        setCopied(false)
    }, [])

    const run = useCallback(async (asKind: GenerateKind) => {
        const projectId = getMeta('ol-project_id')
        if (!projectId) return
        setPhase('busy')
        setError(null)
        setOutput('')
        try {
            // overleaf-lab: no `model` field anymore — the backend reads the
            // user's profile selection (or the deployment default).
            const data = await postJSON(`/project/${projectId}/llm/generate`, {
                body: { type: asKind },
            })
            const text = String(data?.output ?? data?.text ?? '')
            setOutput(text)
            if (text.trim()) {
                setPhase('result')
            }
            else {
                setPhase('error')
                setError(
                    t('llm_generate_empty', 'The model returned an empty result — try again or check the model selection.'),
                )
            }
        }
        catch (err: any) {
            setPhase('error')
            setError(
                err?.data?.message ||
                err?.data?.details ||
                err?.message ||
                t('llm_generate_failed', 'Generation failed — the LLM service may be disabled.'),
            )
        }
    }, [t])

    // overleaf-lab: opening a generator = start immediately (automatic).
    const open = useCallback(
        (asKind: GenerateKind) => {
            start(asKind)
            void run(asKind)
        },
        [start, run],
    )

    useCommandProvider(
        () =>
            isReady
                ? [
                    ...KINDS.map(k => ({
                        type: 'command' as const,
                        id: `llm_generate_${k}`,
                        label: t(`llm_file_generate_${k}`, MENU_LABEL[k]),
                        handler: () => {
                            void open(k)
                        },
                    })),
                    // overleaf-lab (owner request 2026-08-26): the ONE model
                    // selection entry point — File → "Select LLM Model" with the
                    // AI icon in front of the label (leadingIcon is a ReactNode
                    // in the core Command type).
                    {
                        type: 'command' as const,
                        id: 'llm_select_model',
                        label: t('llm_select_model', 'Select LLM Model'),
                        leadingIcon: <MaterialIcon type="smart_toy" />,
                        handler: () => {
                            setModelModalOpen(true)
                        },
                    },
                ]
                : undefined,
        [isReady, open, t],
    )

    const copy = async () => {
        if (!output) return
        try {
            await navigator.clipboard.writeText(output)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
        catch { /* clipboard unavailable (non-secure context) — the text stays selectable */ }
    }

    return (
        <>
        {/* overleaf-lab (owner request 2026-08-26): the ONE shared model selection
            modal — opened from File → "Select LLM Model". */}
        {modelModalOpen && (
            <LLMModelSelectModal
                show={modelModalOpen}
                onHide={() => setModelModalOpen(false)}
            />
        )}
        <OLModal show={kind !== null} onHide={close} size="lg" aria-label={t('llm_generate_title', 'Generate with AI')}>
            <div className="modal-header">
                <h5 className="modal-title">
                    {kind ? t(`llm_generate_${kind}_h`, KIND_LABEL[kind]) : ''}
                </h5>
                <button type="button" className="btn-close" onClick={close} aria-label={t('close', 'Close')} />
            </div>
            <div className="modal-body">
                {phase === 'busy' ? (
                    <p>{t('llm_generate_working', 'Working on it — the model first reads the whole document…')}</p>
                ) : phase === 'result' ? (
                    <div>
                        <p className="muted">{t('llm_generate_hint', 'From the full content of this project:')}</p>
                        <textarea
                            className="form-control llm-gen-result"
                            rows={10}
                            readOnly
                            value={output}
                            aria-label={t('llm_generate_result', 'Generated text')}
                        />
                    </div>
                ) : (
                    <div>
                        {error && <p className="text-danger mb-0">{error}</p>}
                    </div>
                )}
            </div>
            <div className="modal-footer">
                <OLButton variant="secondary" onClick={close}>
                    {t('close', 'Close')}
                </OLButton>
                {phase === 'result' && (
                    <>
                        <OLButton variant="secondary" onClick={() => void open(kind || 'title')}>
                            {t('llm_generate_again', 'Generate again')}
                        </OLButton>
                        <OLButton variant="secondary" disabled={!output} onClick={() => void copy()}>
                            {copied ? t('llm_copied', 'Copied') : t('copy', 'Copy')}
                        </OLButton>
                    </>
                )}
                {phase === 'error' && (
                    <OLButton variant="secondary" onClick={() => void open(kind || 'title')}>
                        {t('llm_generate_retry', 'Try again')}
                    </OLButton>
                )}
            </div>
        </OLModal>
        </>
    )
}
