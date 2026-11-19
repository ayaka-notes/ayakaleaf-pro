import { Form } from 'react-bootstrap'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLButton from '@/shared/components/ol/ol-button'
import type { FieldSpec } from '../sections-meta'

/**
 * The field renderers of the Site Settings page: one component per
 * field type, all on the admin-panel OL components (the same look as
 * /admin/user and /admin/project).
 */

function EnvBadge({ envName }: { envName: string }) {
  return (
    <span
      className="badge bg-warning text-dark ms-2 text-nowrap"
      // inline on purpose: the theme's `.badge` rule sets `padding: 0 4px`
      // and `max-width: 100%`, both of which leave the pill too short
      // to cover its text
      style={{ padding: '2px 8px', whiteSpace: 'nowrap', maxWidth: 'none' }}
      title={`The environment variable ${envName} is set and currently wins over the value stored on this page (docker env is the control plane). The stored value applies where the variable is unset or empty.`}
    >
      env: {envName}
    </span>
  )
}

function StoredBadge() {
  return (
    <span
      className="badge bg-primary text-white ms-1 text-nowrap"
      style={{ padding: '2px 8px', whiteSpace: 'nowrap', maxWidth: 'none' }}
      title="A value is stored on this page for this field (it applies where the environment variable is unset or empty, and after the variable is removed)."
    >
      stored
    </span>
  )
}

type FieldProps = {
  field: FieldSpec
  value: unknown
  onChange: (value: unknown) => void
  envName?: string
  envSet?: boolean
  storedSet?: boolean
  disabled?: boolean
}

function SwitchField({ field, value, onChange, envName, envSet, storedSet, disabled }: FieldProps) {
  return (
    <div className="mb-3">
      <Form.Check
        type="switch"
        id={`ss-${field.key}`}
        checked={Boolean(value)}
        onChange={e => onChange(e.currentTarget.checked)}
        disabled={disabled}
        label={
          <>
            {field.label}
            {envSet && envName ? (
              <span style={{ pointerEvents: 'none' }}>
                <EnvBadge envName={envName} />
              </span>
            ) : null}
            {storedSet ? <StoredBadge /> : null}
          </>
        }
      />
      {field.hint && <Form.Text className="text-muted">{field.hint}</Form.Text>}
    </div>
  )
}

function TextField({
  field,
  value,
  onChange,
  envName,
  envSet,
  storedSet,
  disabled,
  asInput = 'text',
  rows = 1,
}: FieldProps & { asInput?: 'text' | 'password'; rows?: number }) {
  const str = value === undefined || value === null ? '' : String(value)
  return (
    <div className="mb-3">
      <Form.Label htmlFor={`ss-${field.key}`}>
        {field.label}
        {field.required ? <span className="text-danger ms-1">*</span> : null}
        {envSet && envName ? <EnvBadge envName={envName} /> : null}
        {storedSet ? <StoredBadge /> : null}
      </Form.Label>
      <OLFormControl
        id={`ss-${field.key}`}
        type={asInput}
        value={str}
        placeholder={field.placeholder}
        disabled={disabled}
        rows={asInput === 'text' && rows > 1 ? rows : undefined}
        as={asInput === 'text' && rows > 1 ? 'textarea' : 'input'}
        onChange={e => onChange(e.currentTarget.value)}
      />
      {field.hint && <Form.Text className="text-muted">{field.hint}</Form.Text>}
    </div>
  )
}

function NumberField({ field, value, onChange, envName, envSet, storedSet, disabled }: FieldProps) {
  return (
    <div className="mb-3">
      <Form.Label htmlFor={`ss-${field.key}`}>
        {field.label}
        {envSet && envName ? <EnvBadge envName={envName} /> : null}
        {storedSet ? <StoredBadge /> : null}
      </Form.Label>
      <OLFormControl
        id={`ss-${field.key}`}
        type="number"
        value={value === undefined || value === null ? '' : value}
        disabled={disabled}
        onChange={e => {
          const raw = e.currentTarget.value
          onChange(raw === '' ? 0 : Number(raw))
        }}
      />
      {field.hint && <Form.Text className="text-muted">{field.hint}</Form.Text>}
    </div>
  )
}

function StringListField({ field, value, onChange, envName, envSet, storedSet, disabled }: FieldProps) {
  const list = Array.isArray(value) ? value : []
  const text = list.join(', ')
  return (
    <div className="mb-3">
      <Form.Label htmlFor={`ss-${field.key}`}>
        {field.label}
        {envSet && envName ? <EnvBadge envName={envName} /> : null}
        {storedSet ? <StoredBadge /> : null}
      </Form.Label>
      {list.length > 0 && (
        <div className="mb-1">
          {list.map(item => (
            <span key={item} className="badge bg-secondary me-1" style={{ padding: '2px 8px', whiteSpace: 'nowrap', maxWidth: 'none' }}>
              {item}
            </span>
          ))}
        </div>
      )}
      <OLFormControl
        id={`ss-${field.key}`}
        value={text}
        disabled={disabled}
        onChange={e =>
          onChange(
            e.currentTarget.value
              .split(',')
              .map(x => x.trim())
              .filter(Boolean)
          )
        }
      />
      {field.hint && <Form.Text className="text-muted">{field.hint}</Form.Text>}
    </div>
  )
}

type ImageRow = { image: string; name?: string }

function ImagesField({ field, value, onChange, envName, envSet, storedSet, disabled }: FieldProps) {
  const rows: ImageRow[] = Array.isArray(value)
    ? value.map(r => ({ image: r?.image || '', name: r?.name || '' }))
    : []
  const set = (next: ImageRow[]) => onChange(next)
  return (
    <div className="mb-3">
      <Form.Label>
        {field.label}
        {envSet && envName ? <EnvBadge envName={envName} /> : null}
        {storedSet ? <StoredBadge /> : null}
      </Form.Label>
      {rows.map((row, i) => (
        <div key={i} className="row g-2 mb-2">
          <div className="col-md-7">
            <OLFormControl
              aria-label={`Image ${i + 1}`}
              value={row.image}
              disabled={disabled}
              placeholder="texlive/texlive:latest-full"
              onChange={e =>
                set(rows.map((r, j) => (j === i ? { ...r, image: e.currentTarget.value } : r)))
              }
            />
          </div>
          <div className="col-md-4">
            <OLFormControl
              aria-label={`Name ${i + 1}`}
              value={row.name}
              disabled={disabled}
              placeholder="TeXLive 2025"
              onChange={e =>
                set(rows.map((r, j) => (j === i ? { ...r, name: e.currentTarget.value } : r)))
              }
            />
          </div>
          <div className="col-md-1 d-flex align-items-center">
            <OLButton
              variant="danger"
              size="sm"
              aria-label={`Remove image ${i + 1}`}
              disabled={rows.length <= 1}
              onClick={() => set(rows.filter((_, j) => j !== i))}
            >
              ✕
            </OLButton>
          </div>
        </div>
      ))}
      <OLButton
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => set([...rows, { image: '', name: '' }])}
      >
        Add image
      </OLButton>
      {field.hint && <Form.Text className="text-muted mt-1">{field.hint}</Form.Text>}
    </div>
  )
}

export default function FieldRenderer({
  field,
  value,
  onChange,
  envName,
  envSet,
  storedSet,
  disabled,
}: FieldProps) {
  switch (field.type) {
    case 'switch':
      return <SwitchField field={field} value={value} onChange={onChange} envName={envName} envSet={envSet} storedSet={storedSet} disabled={disabled} />
    case 'password':
      return <TextField field={field} value={value} onChange={onChange} envName={envName} envSet={envSet} storedSet={storedSet} disabled={disabled} asInput="password" />
    case 'textarea':
      return <TextField field={field} value={value} onChange={onChange} envName={envName} envSet={envSet} storedSet={storedSet} disabled={disabled} asInput="text" rows={4} />
    case 'number':
      return <NumberField field={field} value={value} onChange={onChange} envName={envName} envSet={envSet} storedSet={storedSet} disabled={disabled} />
    case 'stringlist':
      return <StringListField field={field} value={value} onChange={onChange} envName={envName} envSet={envSet} storedSet={storedSet} disabled={disabled} />
    case 'images':
      return <ImagesField field={field} value={value} onChange={onChange} envName={envName} envSet={envSet} storedSet={storedSet} disabled={disabled} />
    default:
      return <TextField field={field} value={value} onChange={onChange} envName={envName} envSet={envSet} storedSet={storedSet} disabled={disabled} />
  }
}
