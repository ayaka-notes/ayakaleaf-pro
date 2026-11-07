import React, { useCallback } from 'react'
import LabeledRowFormGroup from '../form/labeled-row-form-group'
import FormFieldInput from '../form/form-field-input'
import SettingsTemplateCategory from '../settings/settings-template-category'
import SettingsLicense from '../settings/settings-license'
import SettingsLanguage from '../settings/settings-language'
import { useTranslation } from 'react-i18next'
import type { Template } from '../../../types/template'

interface TemplateFormFieldsProps {
  template: Partial<Template>
  includeLanguage?: boolean
  onChange: (changes: Partial<Template>) => void
  onEnterKey?: () => void
  disable?: boolean
}

function TemplateFormFields({
  template,
  includeLanguage = false,
  onChange,
  onEnterKey,
  disable = false,
}: TemplateFormFieldsProps) {
  const { t } = useTranslation()

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onEnterKey?.()
      }
    },
    [onEnterKey]
  )

  return (
    <>
      <LabeledRowFormGroup controlId="form-title" label={t('title') + ':'}>
        <FormFieldInput
          required
          maxLength="255"
          value={template.name ?? ''}
          placeholder={t('title')}
          onChange={e => onChange({ name: e.target.value })}
          onKeyDown={handleKeyDown}
          disabled={disable}
        />
      </LabeledRowFormGroup>

      <LabeledRowFormGroup controlId="form-author" label={t('author') + ':'}>
        <FormFieldInput
          maxLength="255"
          value={template.authorMD ?? ''}
          placeholder={t('author')}
          onChange={e => onChange({ authorMD: e.target.value })}
          onKeyDown={handleKeyDown}
          disabled={disable}
        />
      </LabeledRowFormGroup>

      <LabeledRowFormGroup controlId="form-category" label={t('categories') + ':'}>
        <SettingsTemplateCategory
          value={template.category}
          onChange={val => onChange({ category: val })}
          disabled={disable}
        />
      </LabeledRowFormGroup>

      <LabeledRowFormGroup controlId="form-description" label={t('description') + ':'}>
        <FormFieldInput
          as="textarea"
          rows={8}
          maxLength="5000"
          value={template.descriptionMD ?? ''}
          placeholder={t('description')}
          onChange={e => onChange({ descriptionMD: e.target.value })}
          autoFocus
          disabled={disable}
        />
      </LabeledRowFormGroup>

      <LabeledRowFormGroup controlId="form-license" label={t('license') + ':'}>
        <SettingsLicense
          value={template.license}
          onChange={val => onChange({ license: val })}
          disabled={disable}
        />
      </LabeledRowFormGroup>

      {includeLanguage && (
        <LabeledRowFormGroup controlId="form-language" label={t('language') + ':'}>
          <SettingsLanguage
            value={template.language}
            onChange={val => onChange({ language: val })}
            disabled={disable}
          />
        </LabeledRowFormGroup>
      )}
    </>
  )
}

export default React.memo(TemplateFormFields)
