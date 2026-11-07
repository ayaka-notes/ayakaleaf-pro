import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useMultipleSelection } from 'downshift'
import SelectCollaborators, { ContactItem } from './select-collaborators'
import { useUserContacts } from '../hooks/use-user-contacts'
import { useProjectContext } from '@/shared/context/project-context'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import AddCollaboratorsSelect from '@/features/share-project-modal/components/add-collaborators-select'
import { useFeatureFlag } from '@/shared/context/split-test-context'

export default function AddCollaborators({ readOnly }: { readOnly?: boolean }) {
  const isSharingUpdatesEnabled = useFeatureFlag('sharing-updates')
  const { data: contacts } = useUserContacts()

  const { t } = useTranslation()

  const { project } = useProjectContext()
  const { members } = project || {}

  const currentMemberEmails = useMemo(
    () => (members || []).map(member => member.email.toLowerCase()).sort(),
    [members]
  )

  const nonMemberContacts = useMemo(() => {
    if (!contacts) {
      return null
    }

    return contacts.filter(
      contact => !currentMemberEmails.includes(contact.email.toLowerCase())
    )
  }, [contacts, currentMemberEmails])

  const multipleSelectionProps = useMultipleSelection<ContactItem>({
    initialActiveIndex: 0,
    initialSelectedItems: [],
  })

  return (
    <OLForm className="add-collabs">
      {isSharingUpdatesEnabled ? (
        <SelectCollaborators
          loading={!nonMemberContacts}
          options={nonMemberContacts || []}
          multipleSelectionProps={multipleSelectionProps}
          currentMemberEmails={currentMemberEmails}
          readOnly={readOnly}
          size="lg"
        />
      ) : (
        <>
          <OLFormGroup>
            <SelectCollaborators
              loading={!nonMemberContacts}
              options={nonMemberContacts || []}
              multipleSelectionProps={multipleSelectionProps}
              currentMemberEmails={currentMemberEmails}
              readOnly={readOnly}
            />
            <OLFormText id="add-collaborator-help-text">
              {t('add_comma_separated_emails_help')}
            </OLFormText>
          </OLFormGroup>
          <OLFormGroup>
            <div className="float-end add-collaborator-controls add-collaborator-controls-legacy">
              <AddCollaboratorsSelect
                readOnly={readOnly}
                multipleSelectionProps={multipleSelectionProps}
                currentMemberEmails={currentMemberEmails}
              />
            </div>
          </OLFormGroup>
        </>
      )}
    </OLForm>
  )
}
