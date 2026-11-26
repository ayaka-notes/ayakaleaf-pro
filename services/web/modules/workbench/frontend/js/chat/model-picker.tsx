import { useEffect, useState } from 'react'

type Model = { id: string; label: string; levels: string[]; defaultLevel?: string }
export type ModelSelection = { modelSelection?: string; reasoningEffort?: string }

export default function ModelPicker({ disabled, onChange }: {
  disabled: boolean
  onChange: (selection: ModelSelection) => void
}) {
  const [models, setModels] = useState<Model[]>([])
  const [selection, setSelection] = useState<ModelSelection>({})
  useEffect(() => {
    const abort = new AbortController()
    fetch('/workbench/models', { signal: abort.signal }).then(async response => {
      if (response.ok) {
        const rows = await response.json()
        if (!abort.signal.aborted) setModels(rows)
      }
    }).catch(() => {})
    onChange({})
    return () => abort.abort()
  }, [onChange])
  function select(next: ModelSelection) {
    setSelection(next)
    onChange(next)
  }
  if (!models.length) return null
  const model = models.find(entry => entry.id === selection.modelSelection)
  return <div className="d-flex align-items-center gap-1 me-2" style={{ minWidth: 0, fontSize: 'var(--font-size-02)' }}>
    <select disabled={disabled} aria-label="AI model" style={{ minWidth: 0, maxWidth: '100%', font: 'inherit' }}
      value={model?.id || ''} onChange={event => select({ modelSelection: event.target.value || undefined })}>
      <option value="">Default model</option>
      {models.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
    </select>
    {model && model.levels.length > 0 && <select disabled={disabled} aria-label="Thinking effort"
      title="Higher effort can improve accuracy on difficult tasks, but may take longer and use more quota."
      style={{ font: 'inherit', color: 'var(--content-secondary-themed)' }}
      value={selection.reasoningEffort || model.defaultLevel}
      onChange={event => select({ modelSelection: model.id, reasoningEffort: event.target.value })}>
      {model.levels.map(level => <option key={level} value={level}>{level}</option>)}
    </select>}
  </div>
}
