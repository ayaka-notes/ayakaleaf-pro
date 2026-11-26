// overleaf-lab (2026): per-log-entry AI Error Assist trigger (upstream-style
// "sparkle" per error/warning entry).
//
// The button (pdfLogEntryHeaderActionComponents) starts the "suggest fix"
// model run for its entry; the result renders INSIDE the same entry via the
// pdfLogEntryComponents card (pdf-llm-compile-fix-card.tsx). Both share the
// per-entry store in utils/llm-compile-fix-store.ts, and the model used is
// the SHARED "Select LLM Model" choice (site lane or a BYO row) — the
// BYO-first stance of this deployment.
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import { requestCompileFix, type LogEntryLike } from '../utils/llm-compile-fix-store'
import { useLLMChat } from '../hooks/use-llm-chat'

interface LogEntry extends LogEntryLike {
    key?: string
    content?: string
    raw?: string
}

interface AskAIButtonProps {
    logEntry?: LogEntry
}

function PdfLogEntryAskAIButton({ logEntry }: AskAIButtonProps) {
    const { t } = useTranslation()
    // Gate on model availability like before: hide the whole affordance when
    // there is nothing to run against (LLM disabled for this user/project).
    const { modelsLoaded, hasModels } = useLLMChat()

    // overleaf-lab: click → run the fix suggestion for THIS entry, then make
    // the result reachable: expand the entry (if collapsed) and scroll it
    // into view, since the card lives in the entry body.
    const handleSuggest = useCallback(() => {
        if (!logEntry) return
        void requestCompileFix(logEntry)
        try {
            const btn = document.querySelector<HTMLButtonElement>(
                `[data-llm-cfx-entry="${String(logEntry.key || logEntry.file + '@' + logEntry.line)}"]`
            )
            const entry = btn ? btn.closest('.log-entry') : null
            if (entry) {
                const headerBtn = entry.querySelector<HTMLElement>('[data-action="expand-collapse"]')
                const collapsed =
                    headerBtn?.getAttribute('data-collapsed') === 'true'
                const contentVisible = !entry.querySelector('.log-entry-content.hidden')
                if (collapsed && !contentVisible && headerBtn) {
                    headerBtn.click()
                }
                entry.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }
        }
        catch {
            // cosmetic only — the model run is already in flight
        }
    }, [logEntry])

    // Show on errors and warnings (upstream shows the sparkle on both); skip
    // informational/typesetting noise and entries without a location.
    if (!logEntry) {
        return null
    }
    if (logEntry.level !== 'error' && logEntry.level !== 'warning') {
        return null
    }
    if (!logEntry.file || !logEntry.line) {
        return null
    }
    if (!modelsLoaded || !hasModels) {
        return null
    }

    const entryKey = String(logEntry.key || logEntry.file + '@' + logEntry.line)

    return (
        <OLTooltip
            id={`llm-cfx-${entryKey}`}
            description={t('llm_cfx_btn', 'Suggest a fix')}
            overlayProps={{ placement: 'bottom' }}
        >
            <span
                data-llm-cfx-entry={entryKey}
                style={{ display: 'inline-flex' }}
            >
                <OLIconButton
                    onClick={handleSuggest}
                    variant="ghost"
                    icon="smart_toy"
                    accessibilityLabel={t('llm_cfx_btn', 'Suggest a fix')}
                />
            </span>
        </OLTooltip>
    )
}

export default memo(PdfLogEntryAskAIButton)
