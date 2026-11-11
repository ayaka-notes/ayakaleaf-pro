import React, { useEffect, useMemo } from 'react'
import { useCodeMirrorStateContext } from './codemirror-context'
import { tagHighlightSettingsField } from '../extensions/tag-highlight'
import {
  computeCommentOutline,
} from '../extensions/comment-outline'
import type {
  CommentOutlineEntry,
} from '../extensions/comment-outline'
import useDebounce from '../../../shared/hooks/use-debounce'
import { useOutlineContext } from '@/features/ide-react/context/outline-context'
import type { HighlightTag } from '@ol-types/user-settings'

// Publishes the list of the user's highlight tags found in the open document
// to the outline context, which is shown below the document outline in the
// File outline panel. Reads the tag-highlight settings field (shared with the
// source-editor highlighting) and the current document text.
export const CommentOutline = React.memo(function CommentOutline() {
  const { setCommentHighlights } = useOutlineContext()
  const state = useCodeMirrorStateContext()
  const debouncedState = useDebounce(state, 100)

  const tagsValue = debouncedState.field(tagHighlightSettingsField, false)
  const tags: HighlightTag[] = Array.isArray(tagsValue) ? tagsValue : []

  const entries: CommentOutlineEntry[] = useMemo(
    () => computeCommentOutline(debouncedState.doc, tags),
    [debouncedState.doc, tags]
  )

  useEffect(() => {
    setCommentHighlights(entries)
  }, [entries, setCommentHighlights])

  return null
})
