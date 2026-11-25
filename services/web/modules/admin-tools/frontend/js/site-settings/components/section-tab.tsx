import { useMemo, useState } from 'react'
import { Form } from 'react-bootstrap'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/notification'
import { putJSON, deleteJSON } from '@/infrastructure/fetch-json'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import type { SectionMeta } from '../sections-meta'
import FieldRenderer from './fields'

/**
 * One section of the Site Settings page: its fields (effective value —
 * env wins over stored over defaults), a save per section, and a reset
 * that removes the stored copy so env + defaults stand again.
 */

export type SectionData = {
  value: Record<string, unknown>
  envSet: Record<string, boolean>
  stored: Record<string, unknown>
}

export default function SectionTab({
  name,
  meta,
  data,
  envFields,
  onSaved,
}: {
  name: string
  meta: SectionMeta
  data: SectionData
  envFields: Record<string, string>
  onSaved: () => void
}) {
  const initial = useMemo(() => {
    const form: Record<string, unknown> = {}
    for (const field of meta.fields) {
      form[field.key] = data.value[field.key]
    }
    return JSON.stringify(form)
  }, [meta, data])

  const [form, setForm] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {}
    for (const field of meta.fields) {
      out[field.key] = data.value[field.key]
    }
    return out
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string[] | null>(null)

  const dirty = JSON.stringify(form) !== initial
  const setField = (key: string, value: unknown) => {
    setForm(f => ({ ...f, [key]: value }))
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await putJSON(`/admin/site-settings/${name}`, { body: form })
      setSaved(true)
      onSaved()
    } catch (err) {
      // the 422 answer is { errors: [...] }; everything else is the
      // fetch layer's message
      const message =
        err && 'errors' in (err as object)
          ? (err as { errors: string[] }).errors
          : [err instanceof Error ? err.message : String(err)]
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await deleteJSON(`/admin/site-settings/${name}`)
      setSaved(true)
      onSaved()
    } catch (err) {
      setError([err instanceof Error ? err.message : String(err)])
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="site-settings-section">
      <p className="text-muted">{meta.description}</p>

      {error && (
        <OLNotification type="error" className="mb-3" content={error.join('\n')} />
      )}
      {saved && !error && (
        <OLNotification
          type="success"
          className="mb-3"
          content="Saved. The value takes effect where the mirrored environment variable is unset or empty, and for sure on the next service (container) start."
        />
      )}

      {meta.fields.map(field => {
        const envName = envFields[field.key]
        // secret fields: the value is never shown (masked server-side);
        // a new value can be entered — empty keeps the current one.
        if (field.type === 'password') {
          const setFlag = Boolean(data.value[`${field.key}Set`])
          const storedSetFlag = Boolean(data.stored[`${field.key}Set`])
          const stateHint = setFlag
            ? storedSetFlag
              ? 'Currently set from this page. Enter a value to replace it; empty keeps it.'
              : 'Currently set from the environment (the environment wins). The value entered here applies where the variable is unset or empty.'
            : 'Not set yet.'
          return (
            <div key={field.key} className="mb-3">
              <Form.Label htmlFor={`ss-${field.key}`}>{field.label}</Form.Label>
              <OLFormControl
                id={`ss-${field.key}`}
                type="password"
                autoComplete="new-password"
                value={typeof form[field.key] === 'string' ? form[field.key] : ''}
                placeholder={setFlag ? '••• (set — empty keeps it)' : ''}
                onChange={e => setField(field.key, e.currentTarget.value)}
              />
              {envName && (
                <Form.Text className="text-muted">
                  Mirrors <code>{envName}</code>
                  {data.envSet[field.key] ? ' — set in the environment, which wins.' : '.'}
                </Form.Text>
              )}
              {stateHint && <Form.Text className="text-muted">{stateHint}</Form.Text>}
              {field.hint && <Form.Text className="text-muted">{field.hint}</Form.Text>}
            </div>
          )
        }
        return (
          <FieldRenderer
            key={field.key}
            field={field}
            value={form[field.key]}
            onChange={v => setField(field.key, v)}
            envName={envName}
            envSet={Boolean(data.envSet[field.key])}
            storedSet={Boolean(data.stored[`${field.key}Set`])}
          />
        )
      })}

      <div className="d-flex gap-2 mt-4 mb-2">
        <OLButton onClick={save} isLoading={saving} disabled={!dirty && !saving}>
          Save
        </OLButton>
        <OLButton
          variant="danger"
          size="sm"
          onClick={reset}
          isLoading={saving}
          disabled={saving}
        >
          Reset to environment/defaults
        </OLButton>
      </div>
      <Form.Text className="text-muted">
        {Object.entries(data.envSet)
          .filter(([, on]) => on)
          .map(([field]) => envFields[field])
          .filter(Boolean)
          .join(', ')}{' '}
        — the variables above are currently set in the environment and win
        over the values stored on this page (external docker env is the
        control plane). Your stored values apply where a variable is unset
        or empty, and after the variable is removed.
      </Form.Text>
    </div>
  )
}


