import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { postJSON, getUserFacingMessage } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import OLButton from '@/shared/components/ol/ol-button'
import Notification from '@/shared/components/notification'
import getMeta from '@/utils/meta'
import type { HighlightTag } from '@ol-types/user-settings'

const DEFAULT_TAG_COLOR = '#ff8c00'
const MAX_TAG_LENGTH = 100
const MAX_TAGS = 50

// Append a semi-transparent alpha to #rrggbb colours so the preview and the
// editor highlight stay readable over both light and dark backgrounds.
function withAlpha(color: string) {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}4D` : color
}

type HighlightFormProps = {
  initialTags: HighlightTag[]
  onSaved?: (tags: HighlightTag[]) => void
}

export default function HighlightForm({
  initialTags,
  onSaved,
}: HighlightFormProps) {
  const { t } = useTranslation()
  const [tags, setTags] = useState<HighlightTag[]>(initialTags)
  const [newTag, setNewTag] = useState('')
  const { isLoading, isError, error, runAsync } = useAsync()

  const save = (nextTags: HighlightTag[]) => {
    setTags(nextTags)
    onSaved?.(nextTags)
    runAsync(
      postJSON('/user/settings', {
        body: { highlight: nextTags },
      })
    ).catch(() => {})
  }

  const updateTag = (index: number, updated: HighlightTag) => {
    save(tags.map((tag, i) => (i === index ? updated : tag)))
  }

  const removeTag = (index: number) => {
    save(tags.filter((_, i) => i !== index))
  }

  const addTag = () => {
    const name = newTag.trim()
    if (name === '' || tags.length >= MAX_TAGS) {
      setNewTag('')
      return
    }
    // ignore duplicate tags (case-insensitive)
    if (tags.some(tag => tag.tag.toLowerCase() === name.toLowerCase())) {
      setNewTag('')
      return
    }
    save([...tags, { tag: name, color: DEFAULT_TAG_COLOR }])
    setNewTag('')
  }

  return (
    <div className="highlight-form">
      {isError && (
        <div className="notification-list">
          <Notification
            type="error"
            content={getUserFacingMessage(error)}
            className="mb-3"
          />
        </div>
      )}

      <div className="highlight-tag-list">
        {tags.map((tag, index) => (
          <HighlightTagRow
            key={`${tag.tag}-${index}`}
            tag={tag}
            canRemove={tags.length > 0}
            onChange={updated => updateTag(index, updated)}
            onRemove={() => removeTag(index)}
          />
        ))}
      </div>

      <div className="highlight-add-row d-flex align-items-center">
        <input
          type="text"
          value={newTag}
          maxLength={MAX_TAG_LENGTH}
          placeholder={t('highlight_new_tag_placeholder')}
          className="form-control"
          aria-label={t('highlight_new_tag')}
          onChange={event => setNewTag(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              addTag()
            }
          }}
        />
        <OLButton
          type="button"
          variant="primary"
          leadingIcon="add"
          isLoading={isLoading}
          disabled={newTag.trim() === '' || tags.length >= MAX_TAGS}
          onClick={addTag}
        >
          {t('highlight_add_tag')}
        </OLButton>
      </div>
    </div>
  )
}

function HighlightTagRow({
  tag,
  canRemove,
  onChange,
  onRemove,
}: {
  tag: HighlightTag
  canRemove: boolean
  onChange: (updated: HighlightTag) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(tag.tag)

  // keep the draft in sync when the stored value changes elsewhere
  useEffect(() => {
    setDraft(tag.tag)
  }, [tag.tag])

  const commit = () => {
    const nextTag = draft.trim()
    if (nextTag === tag.tag) {
      setDraft(tag.tag)
    } else {
      onChange({ tag: nextTag, color: tag.color })
    }
  }

  return (
    <div className="highlight-tag-row d-flex align-items-center">
      <input
        type="text"
        value={draft}
        maxLength={MAX_TAG_LENGTH}
        placeholder="TODO"
        className="form-control"
        aria-label={`${t('highlight_tag')}: ${tag.tag}`}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            commit()
          }
        }}
      />
      <input
        type="color"
        value={tag.color}
        title={t('highlight_color')}
        aria-label={`${t('highlight_color')}: ${tag.tag}`}
        className="highlight-color-input"
        onChange={event => onChange({ tag: tag.tag, color: event.target.value })}
      />
      <span
        className="highlight-tag-preview"
        style={{ backgroundColor: withAlpha(tag.color) }}
      >
        % {tag.tag}
      </span>
      <OLButton
        type="button"
        variant="ghost"
        leadingIcon="delete"
        disabled={!canRemove}
        onClick={onRemove}
      >
        {t('highlight_remove')}
      </OLButton>
    </div>
  )
}
