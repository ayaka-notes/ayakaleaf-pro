import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CommentOutlineEntry,
} from '@/features/source-editor/extensions/comment-outline'

// A list of the special comments (the user's highlight tags) found in the
// open document, shown below the document outline in the File outline panel.
// Each entry shows the tag, its line number, and the rest of the comment;
// clicking it jumps the editor to that line.
const CommentOutlinePane = memo(function CommentOutlinePane({
  entries,
  jumpToLine,
}: {
  entries: CommentOutlineEntry[]
  jumpToLine: (line: number, syncToPdf: boolean) => void
}) {
  const { t } = useTranslation()

  if (entries.length === 0) {
    return null
  }

  return (
    <div className="outline-pane comment-outline-pane">
      <div className="outline-header">
        <h4 className="outline-header-name">{t('special_comments')}</h4>
      </div>
      <div className="outline-body">
        <ul className="outline-item-list comment-outline-list" role="list">
          {entries.map((entry, index) => (
            <li
              key={`${entry.line}-${index}`}
              className="comment-outline-item"
              role="listitem"
            >
              <button
                className="outline-item-link comment-outline-link"
                onClick={event => {
                  const syncToPdf = event.detail === 2
                  jumpToLine(entry.line, syncToPdf)
                }}
                aria-label={`${entry.tag} ${t('highlight_line')} ${entry.line}${
                  entry.text ? `: ${entry.text}` : ''
                }`}
              >
                <span
                  className="comment-outline-tag"
                  style={{ backgroundColor: entry.color }}
                >
                  {entry.tag}
                </span>
                <span className="comment-outline-line">{entry.line}</span>
                {entry.text && (
                  <span className="comment-outline-text">{entry.text}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
})

export default CommentOutlinePane
