/**
 * Where the user writes: a growing text box, images and PDF files by picker,
 * paste or drop,
 * a note of the selected lines that go along, and send or stop.
 */
import { forwardRef, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileUIPart } from 'ai'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import { boxed, flatGhost, plain, surface } from './themed'
import ImagePreview from './image-preview'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 8

export type Draft = { text: string; files: FileUIPart[] }

const isPdf = (file: File) => file.type === 'application/pdf'

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const Composer = forwardRef<
  HTMLTextAreaElement,
  {
    working: boolean
    selectionNote?: string
    onSend: (draft: Draft) => void
    onStop: () => void
    onProblem: (message: string | false) => void
  }
>(function Composer({ working, selectionNote, onSend, onStop, onProblem }, ref) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [attached, setAttached] = useState<File[]>([])
  const picker = useRef<HTMLInputElement>(null)
  // Object URLs for the image previews, released when the files change or go
  const previews = useMemo(
    () => attached.map(file => (isPdf(file) ? undefined : URL.createObjectURL(file))),
    [attached]
  )
  useEffect(() => () => previews.forEach(url => url && URL.revokeObjectURL(url)), [previews])

  const attach = (files: File[]) => {
    onProblem(false)
    if (files.some(file => !file.type.startsWith('image/') && !isPdf(file))) {
      onProblem('Only images and PDF files can be attached.')
    } else if (files.some(file => file.size > MAX_FILE_BYTES)) {
      onProblem('Files must be smaller than 2 MB.')
    } else {
      setAttached(current => [...current, ...files])
    }
  }

  const send = async () => {
    if (working || !text.trim()) return
    const files = await Promise.all(
      attached.map(async file => ({
        type: 'file' as const,
        mediaType: file.type,
        filename: file.name,
        url: await readAsDataUrl(file),
      }))
    )
    onSend({ text, files })
    setText('')
    setAttached([])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while an input method is composing picks a candidate
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const onPaste = (event: ClipboardEvent) => {
    const pasted = Array.from(event.clipboardData.files)
    if (pasted.length) {
      event.preventDefault()
      attach(pasted)
    }
  }

  const onDrop = (event: DragEvent) => {
    if (event.dataTransfer.files.length) {
      event.preventDefault()
      attach(Array.from(event.dataTransfer.files))
    }
  }

  const rows = Math.min(MAX_ROWS, Math.max(2, text.split('\n').length))

  return (
    <div
      className="rounded m-2 p-2 d-flex flex-column gap-2"
      // Writing in the box rings it, like a focused form field
      style={
        focused
          ? { border: '1px solid var(--border-active-themed)', boxShadow: 'var(--blue-30) 0 0 0 2px' }
          : boxed
      }
      onDragOver={event => event.dataTransfer.types.includes('Files') && event.preventDefault()}
      onDrop={onDrop}
    >
      {(selectionNote || attached.length > 0) && (
        <div className="d-flex flex-wrap gap-1 small">
          {selectionNote && (
            <span className="badge d-inline-flex align-items-center gap-1" style={{ ...surface, ...plain }}>
              <MaterialIcon type="code" /> {selectionNote}
            </span>
          )}
          {attached.map((file, index) => (
            <span className="badge d-inline-flex align-items-center gap-1" style={{ ...surface, ...plain }} key={index}>
              {isPdf(file) ? (
                <span className="d-inline-flex align-items-center gap-1">
                  <MaterialIcon type="picture_as_pdf" /> {file.name}
                </span>
              ) : (
                <ImagePreview src={previews[index]!} name={file.name}>
                  <span className="d-inline-flex align-items-center gap-1" tabIndex={0}>
                    <MaterialIcon type="image" /> {file.name}
                  </span>
                </ImagePreview>
              )}
              <button
                type="button"
                className="btn btn-link p-0 text-reset d-inline-flex"
                aria-label={`Remove ${file.name}`}
                onClick={() => setAttached(attached.filter((_, other) => other !== index))}
              >
                <MaterialIcon type="close" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        className="form-control border-0 shadow-none p-1"
        style={{ ...plain, resize: 'none', fontSize: 'var(--font-size-02)', background: 'transparent' }}
        rows={rows}
        placeholder={t('what_would_you_like_to_do')}
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <div className="d-flex align-items-center">
        <input
          ref={picker}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          aria-label="Attach images or PDF files"
          onChange={event => {
            attach(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <OLTooltip id="assistant-attach" description={t('attach_image_or_pdf')}>
          <OLIconButton
            icon="add_photo_alternate"
            variant="ghost"
            style={{ ...flatGhost, ...plain }}
            accessibilityLabel={t('attach_image_or_pdf')}
            onClick={() => picker.current?.click()}
          />
        </OLTooltip>
        <span className="flex-grow-1" />
        {working ? (
          <OLIconButton icon="stop_circle" variant="ghost" style={{ ...flatGhost, ...plain }} accessibilityLabel={t('stop')} onClick={onStop} />
        ) : (
          <OLIconButton
            icon="arrow_upward"
            variant="ghost"
            style={{ ...flatGhost, ...plain }}
            accessibilityLabel={t('send')}
            disabled={!text.trim()}
            onClick={send}
          />
        )}
      </div>
    </div>
  )
})

export default Composer
