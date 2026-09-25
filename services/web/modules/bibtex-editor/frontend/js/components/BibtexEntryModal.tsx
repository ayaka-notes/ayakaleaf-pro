import { useMemo, useState } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLFormFeedback from '@/shared/components/ol/ol-form-feedback'
import OLAutocomplete from '@/shared/components/ol/ol-autocomplete'
import MaterialIcon from '@/shared/components/material-icon'
import { BibEntry, FieldValue } from '../bibtex/bibtex-entry'
import {
  getEntryTypeOptions,
  getEntryTypeKeys,
  getEntryTypeSchema,
  getFieldsForEntryType,
  getFieldMeta,
} from '../bibtex/field-schema'

// The "Add reference" / "Edit reference" modal. react-hook-form drives an
// entry-type selector, a validated citation key, the entry type's fields, and
// a collapsible "Optional" section with a searchable "Add field" control.

type FieldRow = { key: string; value: string }

type FormValues = {
  type: string
  key: string
  fieldsList: FieldRow[]
}

// Citation key: first char excludes digits; subsequent chars allow digits.
const CITATION_KEY_RE =
  /^[A-Za-z!$&*+./:;<>?^_`|\[\]-][A-Za-z0-9!$&*+./:;<>?^_`|\[\]-]*$/

// Field name validity: same charset as citation keys. Free-typed "Add field"
// names must pass this or they would serialize to invalid BibTeX.
const FIELD_NAME_RE = CITATION_KEY_RE

// The form edits a field's "editable" representation: the raw source minus its
// outer {…}/"…" delimiter, with inner braces (case protection, LaTeX groups)
// preserved. Bare values (numbers, @string macro references, concatenations)
// are shown as-is.
function toEditableValue(fv: FieldValue): string {
  const raw = fv.raw.trim()
  if (raw.length >= 2 && raw.startsWith('{') && raw.endsWith('}')) {
    // strip the outer braces only if they wrap the entire value
    let depth = 0
    for (let i = 0; i < raw.length - 1; i++) {
      if (raw[i] === '{') depth++
      else if (raw[i] === '}') depth--
      if (depth === 0) return raw // closes early, e.g. `{A} # {B}`
    }
    return raw.slice(1, -1)
  }
  if (
    raw.length >= 2 &&
    raw.startsWith('"') &&
    raw.endsWith('"') &&
    !raw.slice(1, -1).includes('"')
  ) {
    return raw.slice(1, -1)
  }
  return raw
}

// Turn an existing entry's fields into ordered rows.
function entryToRows(entry?: BibEntry): FieldRow[] {
  if (!entry) return []
  return entry
    .getFieldNames()
    .map(name => ({ key: name, value: toEditableValue(entry.getField(name)) }))
}

// Field rows for a type: the type's own fields (each carrying its existing
// value if present), followed by any current field NOT in the type's fields
// that has a non-empty value.
function computeFieldsList(type: string, current: FieldRow[]): FieldRow[] {
  const typeFields = getFieldsForEntryType(type)
  const present = new Map(current.map(f => [f.key, f.value]))
  const rows: FieldRow[] = typeFields.map(key => ({
    key,
    value: present.get(key) ?? '',
  }))
  const shown = new Set(typeFields)
  for (const f of current) {
    if (!shown.has(f.key) && f.value.trim() !== '') {
      rows.push({ key: f.key, value: f.value })
    }
  }
  return rows
}

// Every field referenced by any entry type, aggregated across the type schemas,
// used to populate the "Add optional field" autocomplete.
function getAllKnownFieldKeys(): string[] {
  const set = new Set<string>()
  for (const key of getEntryTypeKeys()) {
    const schema = getEntryTypeSchema(key)
    for (const f of schema.fields) set.add(f)
    for (const f of schema.optionalFields) set.add(f)
    for (const spec of schema.requiredFields) {
      if (typeof spec === 'string') set.add(spec)
      else spec.forEach(s => set.add(s))
    }
  }
  return [...set]
}

export default function BibtexEntryModal({
  show,
  entry,
  existingKeys,
  onSave,
  onCancel,
}: {
  show: boolean
  entry?: BibEntry
  existingKeys: Set<string>
  onSave: (next: BibEntry) => void
  onCancel: () => void
}) {
  const entryTypeOptions = useMemo(() => getEntryTypeOptions(), [])

  const { control, handleSubmit, watch, setValue, getValues, formState } =
    useForm<FormValues>({
      mode: 'onChange',
      defaultValues: {
        type: entry?.type ?? '',
        key: entry?.key ?? '',
        fieldsList: entry
          ? computeFieldsList(entry.type, entryToRows(entry))
          : [],
      },
    })

  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: 'fieldsList',
  })

  const { isDirty, isSubmitting } = formState

  const type = watch('type')

  const [typeSelectorOpen, setTypeSelectorOpen] = useState(false)
  const [optionalOpen, setOptionalOpen] = useState(false)
  const [addFieldOpen, setAddFieldOpen] = useState(false)

  const typeLabel = useMemo(() => {
    if (!type) return undefined
    return entryTypeOptions.find(o => o.value === type)?.label ?? type
  }, [type, entryTypeOptions])

  const typeFields = useMemo(() => getFieldsForEntryType(type), [type])

  // Partition the field rows, keeping each row's index for RHF paths / removal.
  const fieldEntries = fields.map((field, index) => ({ field, index }))
  const standardFieldEntries = fieldEntries.filter(({ field }) =>
    typeFields.includes(field.key)
  )
  const extraFieldEntries = fieldEntries.filter(
    ({ field }) => !typeFields.includes(field.key)
  )

  const availableToAdd = useMemo(() => {
    const shown = new Set(fields.map(f => f.key.toLowerCase()))
    return getAllKnownFieldKeys()
      .filter(k => !shown.has(k.toLowerCase()))
      .map(k => ({ value: k, label: getFieldMeta(k)?.label ?? k }))
  }, [fields])

  const handleTypePick = (newType: string) => {
    if (!newType) return
    setValue('type', newType, { shouldDirty: true, shouldValidate: true })
    replace(computeFieldsList(newType, getValues('fieldsList')))
    setTypeSelectorOpen(false)
  }

  const handleAddField = (name: string) => {
    const trimmed = name.trim()
    // valid field name AND not already present (case-insensitive)
    if (trimmed && FIELD_NAME_RE.test(trimmed)) {
      const exists = getValues('fieldsList').some(
        f => f.key.toLowerCase() === trimmed.toLowerCase()
      )
      if (!exists) append({ key: trimmed, value: '' })
    }
    setAddFieldOpen(false)
  }

  const onValid = (values: FormValues) => {
    let next = new BibEntry({
      type: values.type,
      key: values.key.trim(),
      id: entry?.id,
    })
    for (const field of values.fieldsList) {
      if (field.value.trim() === '') continue
      const original = entry?.getField(field.key)
      if (original?.raw && field.value === toEditableValue(original)) {
        // untouched: keep the field's raw source unchanged (round-trip)
        next = next.setFieldValue(field.key, original)
      } else {
        next = next.setField(field.key, field.value)
      }
    }
    onSave(next)
  }

  return (
    <OLModal show={show} onHide={onCancel} size="lg" scrollable>
      <OLModalHeader closeButton>
        <OLModalTitle>
          {entry ? 'Edit reference' : 'Add reference'}
        </OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <form id="bibtex-entry-form" onSubmit={handleSubmit(onValid)}>
          <OLFormGroup>
            <OLFormLabel htmlFor="ref-type">Entry type</OLFormLabel>
            {typeSelectorOpen ? (
              <OLAutocomplete
                items={entryTypeOptions}
                label="Entry type"
                placeholder="Select entry type"
                allowCreate
                isOpen
                onClose={() => setTypeSelectorOpen(false)}
                onChange={handleTypePick}
              />
            ) : (
              <button
                type="button"
                id="ref-type"
                className="form-control text-start d-flex justify-content-between align-items-center w-100 entry-type-selector-btn"
                onClick={() => setTypeSelectorOpen(true)}
              >
                <span>{typeLabel ?? 'Select'}</span>
                <MaterialIcon type="keyboard_arrow_down" />
              </button>
            )}
          </OLFormGroup>

          {type ? (
            <>
              <OLFormGroup>
                <OLFormLabel htmlFor="ref-key">Citation key</OLFormLabel>
                <Controller
                  control={control}
                  name="key"
                  rules={{
                    required: 'Required field',
                    validate: value => {
                      const trimmed = value.trim()
                      if (!CITATION_KEY_RE.test(trimmed)) {
                        return 'Invalid citation key'
                      }
                      if (
                        trimmed !== entry?.key &&
                        existingKeys.has(trimmed)
                      ) {
                        return 'This citation key is already in use'
                      }
                      return true
                    },
                  }}
                  render={({ field, fieldState }) => (
                    <>
                      <OLFormControl
                        id="ref-key"
                        type="text"
                        {...field}
                        isInvalid={Boolean(fieldState.error)}
                      />
                      <OLFormText>
                        This is how you will refer to this reference, e.g. with{' '}
                        {'\\cite{key}'}
                      </OLFormText>
                      {fieldState.error ? (
                        <OLFormFeedback type="invalid">
                          {fieldState.error.message}
                        </OLFormFeedback>
                      ) : null}
                    </>
                  )}
                />
              </OLFormGroup>

              {standardFieldEntries.map(({ field, index }) => {
                const meta = getFieldMeta(field.key)
                return (
                  <OLFormGroup className="mb-3" key={field.id}>
                    <OLFormLabel htmlFor={`ref-field-${index}`}>
                      {meta?.label ?? field.key}
                    </OLFormLabel>
                    <Controller
                      control={control}
                      name={`fieldsList.${index}.value`}
                      render={({ field: ctrl, fieldState }) => (
                        <>
                          <OLFormControl
                            id={`ref-field-${index}`}
                            as="textarea"
                            rows={1}
                            {...ctrl}
                            isInvalid={Boolean(fieldState.error)}
                          />
                          {meta?.helperText ? (
                            <OLFormText>{meta.helperText}</OLFormText>
                          ) : null}
                          {fieldState.error ? (
                            <OLFormFeedback type="invalid">
                              {fieldState.error.message}
                            </OLFormFeedback>
                          ) : null}
                        </>
                      )}
                    />
                  </OLFormGroup>
                )
              })}

              <div className="bibtex-collapsible">
                <button
                  type="button"
                  className="bibtex-collapsible-heading"
                  onClick={() => setOptionalOpen(open => !open)}
                  aria-expanded={optionalOpen}
                  aria-label={
                    optionalOpen ? 'Collapse Optional' : 'Expand Optional'
                  }
                >
                  <span className="mb-0">Optional</span>
                  <MaterialIcon
                    type={
                      optionalOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'
                    }
                    className="bibtex-collapsible-heading-icon"
                  />
                </button>

                {optionalOpen ? (
                  <>
                    {extraFieldEntries.map(({ field, index }) => {
                      const meta = getFieldMeta(field.key)
                      return (
                        <OLFormGroup className="mb-3" key={field.id}>
                          <div className="d-flex justify-content-between align-items-center">
                            <OLFormLabel htmlFor={`ref-field-${index}`}>
                              {meta?.label ?? field.key}
                            </OLFormLabel>
                            <OLButton
                              variant="ghost"
                              size="sm"
                              onClick={() => remove(index)}
                              aria-label="Delete field"
                            >
                              <MaterialIcon type="close" />
                            </OLButton>
                          </div>
                          <Controller
                            control={control}
                            name={`fieldsList.${index}.value`}
                            render={({ field: ctrl }) => (
                              <OLFormControl
                                id={`ref-field-${index}`}
                                as="textarea"
                                rows={1}
                                {...ctrl}
                              />
                            )}
                          />
                          {meta?.helperText ? (
                            <OLFormText>{meta.helperText}</OLFormText>
                          ) : null}
                        </OLFormGroup>
                      )
                    })}

                    {addFieldOpen ? (
                      <OLAutocomplete
                        items={availableToAdd}
                        label="Add optional field"
                        placeholder="Enter field name"
                        useFuzzySearch
                        expandUp
                        allowCreate
                        isOpen
                        onClose={() => setAddFieldOpen(false)}
                        onChange={handleAddField}
                      />
                    ) : (
                      <OLButton
                        variant="ghost"
                        className="bibtex-add-field-button"
                        leadingIcon="add"
                        onClick={() => setAddFieldOpen(true)}
                      >
                        Add field
                      </OLButton>
                    )}
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <OLFormText>Select an entry type to continue</OLFormText>
          )}
        </form>
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onCancel}>
          Cancel
        </OLButton>
        <OLButton
          variant="primary"
          type="submit"
          form="bibtex-entry-form"
          disabled={!isDirty || isSubmitting}
        >
          Save
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
