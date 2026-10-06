/**
 * Provides the chat composer, attachment state, and submission controls.
 * Converts attachments to data URLs for submission and supports editor
 * selection context, model and tool menus, and voice input.
 */
import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FC,
  type FormEvent,
  type PropsWithChildren,
  type ReactNode,
  type RefObject,
} from 'react'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import { Form, InputGroup, OverlayTrigger, Popover } from 'react-bootstrap'
import { v4 as uuid } from 'uuid'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLFormSwitch from '@/shared/components/ol/ol-form-switch'
import MaterialIcon from '@/shared/components/material-icon'
import {
  OLDropdown as Dropdown,
  OLDropdownToggle as DropdownToggle,
  OLDropdownMenu as DropdownMenu,
  OLDropdownItem as DropdownItem,
  OLDropdownHeader as DropdownHeader,
} from '@/shared/components/ol/ol-dropdown-menu'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'
import { sendMB } from '@/infrastructure/event-tracking'
import { useWorkbenchSettings } from '../context/workbench-settings-context'

export type PromptAttachment = {
  id: string
  type: 'file'
  url: string
  mediaType: string
  filename: string
}

export type PromptSubmitPayload = {
  text: string
  files?: Omit<PromptAttachment, 'id'>[]
}

type AttachmentsApi = {
  files: PromptAttachment[]
  add: (files: Iterable<File>) => void
  remove: (id: string) => void
  clear: () => void
  openFileDialog: () => void
  fileInputRef: RefObject<HTMLInputElement | null>
}

type PromptInputApi = {
  textInput: {
    value: string
    setInput: (value: string) => void
    clear: () => void
  }
  attachments: AttachmentsApi
  __registerFileInput: (
    ref: RefObject<HTMLInputElement | null>,
    open: () => void
  ) => void
}

const PromptInputContext = createContext<PromptInputApi | null>(null)
const AttachmentsContext = createContext<AttachmentsApi | null>(null)

export const usePromptInput = () => {
  const context = useContext(PromptInputContext)
  if (!context) {
    throw new Error('Wrap component in <PromptInputProvider>.')
  }
  return context
}

export const usePromptInputAttachments = () => {
  const context = useContext(AttachmentsContext)
  if (!context) {
    throw new Error('usePromptInputAttachments used outside PromptInput')
  }
  return context
}

/** Convert a blob: URL into a data: URL for submission. */
async function blobUrlToDataUrl(url: string): Promise<string> {
  if (!url.startsWith('blob:')) {
    throw new Error('URL must be a blob URL')
  }
  const response = await fetch(url)
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export const PromptInputProvider: FC<
  PropsWithChildren<{ initialInput?: string }>
> = ({ initialInput = '', children }) => {
  const [value, setInput] = useState(initialInput)
  const clear = useCallback(() => setInput(''), [])
  const [files, setFiles] = useState<PromptAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openDialogRef = useRef<() => void>(() => {})

  const add = useCallback((fileList: Iterable<File>) => {
    const items = Array.from(fileList)
    if (items.length) {
      setFiles(files =>
        files.concat(
          items.map(file => ({
            id: uuid(),
            type: 'file' as const,
            url: URL.createObjectURL(file),
            mediaType: file.type,
            filename: file.name,
          }))
        )
      )
    }
  }, [])

  const remove = useCallback((id: string) => {
    setFiles(files => {
      const found = files.find(file => file.id === id)
      if (found?.url) {
        URL.revokeObjectURL(found.url)
      }
      return files.filter(file => file.id !== id)
    })
  }, [])

  const clearFiles = useCallback(() => {
    setFiles(files => {
      for (const file of files) {
        if (file.url) {
          URL.revokeObjectURL(file.url)
        }
      }
      return []
    })
  }, [])

  const openFileDialog = useCallback(() => openDialogRef.current?.(), [])

  const attachments = useMemo<AttachmentsApi>(
    () => ({
      files,
      add,
      remove,
      clear: clearFiles,
      openFileDialog,
      fileInputRef,
    }),
    [files, add, remove, clearFiles, openFileDialog]
  )

  const registerFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>, open: () => void) => {
      fileInputRef.current = ref.current
      openDialogRef.current = open
    },
    []
  )

  const api = useMemo<PromptInputApi>(
    () => ({
      textInput: { value, setInput, clear },
      attachments,
      __registerFileInput: registerFileInput,
    }),
    [value, clear, attachments, registerFileInput]
  )

  return (
    <PromptInputContext.Provider value={api}>
      <AttachmentsContext.Provider value={attachments}>
        {children}
      </AttachmentsContext.Provider>
    </PromptInputContext.Provider>
  )
}

/** Attachment chip with remove button and image hover preview. */
const AttachmentChip = ({ data }: { data: PromptAttachment }) => {
  const attachments = usePromptInputAttachments()
  const filename = data.filename || ''
  const isImage = data.mediaType?.startsWith('image/') && data.url
  const chip = (
    <div className="d-flex align-items-center gap-1 px-2 py-1 small workbench-attachment">
      <div className="position-relative" style={{ width: 20, height: 20 }}>
        <OLIconButton
          icon="close"
          accessibilityLabel="Remove attachment"
          variant="secondary"
          size="sm"
          className="position-absolute top-0 end-0 p-0"
          onClick={e => {
            e.stopPropagation()
            attachments.remove(data.id)
          }}
        />
      </div>
      <span className="text-truncate" style={{ maxWidth: 120 }}>
        {filename || (isImage ? 'Image' : 'Attachment')}
      </span>
    </div>
  )
  if (isImage) {
    return (
      <OverlayTrigger
        trigger={['hover', 'focus']}
        placement="top"
        overlay={
          <Popover id={`pop-${data.id}`}>
            <Popover.Body>
              <img
                alt={filename || 'attachment preview'}
                src={data.url}
                style={{ maxWidth: '100%', maxHeight: 300, objectFit: 'contain' }}
              />
            </Popover.Body>
          </Popover>
        }
      >
        {chip}
      </OverlayTrigger>
    )
  }
  return chip
}

/** The read-only editor-selection chip. */
export const EditorSelectionAttachment = memo(function EditorSelectionAttachment({
  currentPath,
  editorSelectionRanges,
}: {
  currentPath: string
  editorSelectionRanges: { fromLine: number; toLine: number; empty: boolean }[]
}) {
  const lines = useMemo(
    () =>
      editorSelectionRanges
        .filter(range => !range.empty)
        .map(range =>
          range.fromLine === range.toLine
            ? `${range.fromLine}`
            : `${range.fromLine}-${range.toLine}`
        )
        .join(','),
    [editorSelectionRanges]
  )
  const filename = useMemo(() => currentPath.split('/').pop(), [currentPath])
  return (
    <div className="d-flex align-items-center gap-1 px-2 py-1 small workbench-attachment workbench-editor-selection-attachment">
      <span className="text-truncate" style={{ maxWidth: 160 }}>
        <MaterialIcon type="code" className="align-middle" /> {filename}: {lines}
      </span>
    </div>
  )
})

/** Form wrapper: hidden file input, drag&drop, submit pipeline. */
const PromptInputForm: FC<
  PropsWithChildren<{
    accept?: string
    multiple?: boolean
    onSubmit: (
      payload: PromptSubmitPayload,
      event: FormEvent
    ) => Promise<boolean | undefined> | boolean | undefined
    className?: string
    setError: (error: string | false) => void
  }>
> = ({ accept, multiple, onSubmit, children, className, setError }) => {
  const api = usePromptInput()
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    const form = anchorRef.current?.closest('form')
    if (form instanceof HTMLFormElement) {
      formRef.current = form
    }
  }, [])

  const files = api.attachments.files

  const addFiles = useMemo(
    () => (fileList: Iterable<File>) => {
      setError(false)
      const items = Array.from(fileList)
      if (items.length) {
        if (items.some(file => !file.type.startsWith('image/'))) {
          setError('Only image files are allowed')
        } else if (items.some(file => file.size > 2097152)) {
          setError('All files must be smaller than 2MB')
        } else {
          api.attachments.add(items)
        }
      }
    },
    [api, setError]
  )

  const clearFiles = useMemo(() => () => api.attachments.clear(), [api])

  useEffect(() => {
    api.__registerFileInput(inputRef, () => inputRef.current?.click())
  }, [api])

  useEffect(() => {
    const form = formRef.current
    if (!form) {
      return
    }
    const handleDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault()
      }
    }
    const handleDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault()
      }
      if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
        addFiles(event.dataTransfer.files)
      }
    }
    form.addEventListener('dragover', handleDragOver)
    form.addEventListener('drop', handleDrop)
    return () => {
      form.removeEventListener('dragover', handleDragOver)
      form.removeEventListener('drop', handleDrop)
    }
  }, [addFiles])

  return (
    <>
      <span aria-hidden="true" className="d-none" ref={anchorRef} />
      <input
        accept={accept}
        aria-label="Upload files"
        multiple={multiple}
        onChange={event => {
          if (event.currentTarget.files) {
            addFiles(event.currentTarget.files)
          }
        }}
        ref={inputRef}
        title="Upload files"
        type="file"
        style={{ display: 'none' }}
      />
      <Form
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          const text = api.textInput.value
          Promise.all(
            files.map(async ({ id, ...file }) => {
              if (file.url && file.url.startsWith('blob:')) {
                return { ...file, url: await blobUrlToDataUrl(file.url) }
              }
              return file
            })
          ).then(async resolvedFiles => {
            try {
              if (await onSubmit({ text, files: resolvedFiles }, event)) {
                clearFiles()
                api.textInput.clear()
              }
            } catch {}
          })
        }}
        className={className}
      >
        <InputGroup className="w-100 flex-column gap-2">{children}</InputGroup>
      </Form>
    </>
  )
}

/** Enter-to-send textarea with composition/paste/backspace handling. */
const PromptTextarea = forwardRef<HTMLTextAreaElement, { placeholder?: string }>(
  function PromptTextarea({ placeholder }, ref) {
    const api = usePromptInput()
    const attachments = usePromptInputAttachments()
    const [composing, setComposing] = useState(false)
    return (
      <Form.Control
        as="textarea"
        className="w-100 workbench-prompt-input-textarea"
        name="message"
        placeholder={placeholder}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            if (composing || event.nativeEvent.isComposing) {
              return
            }
            if (event.shiftKey) {
              return
            }
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
          if (
            event.key === 'Backspace' &&
            event.currentTarget.value === '' &&
            attachments.files.length > 0
          ) {
            event.preventDefault()
            const last = attachments.files.at(-1)
            if (last) {
              attachments.remove(last.id)
            }
          }
        }}
        onPaste={event => {
          const items = event.clipboardData?.items
          if (!items) {
            return
          }
          const files: File[] = []
          for (const item of items) {
            if (item.kind === 'file') {
              const file = item.getAsFile()
              if (file?.type.startsWith('image/')) {
                files.push(file)
              }
            }
          }
          if (files.length > 0) {
            event.preventDefault()
            attachments.add(files)
          }
        }}
        value={api.textInput.value}
        onChange={event => {
          api.textInput.setInput(event.currentTarget.value)
        }}
        ref={ref}
      />
    )
  }
)

/** Status-aware submit button. */
const SubmitButton = ({ status, ...props }: { status: string } & any) => {
  switch (status) {
    case 'submitted':
      return (
        <OLIconButton
          {...props}
          type="submit"
          icon="progress_activity"
          variant="ghost"
          style={{ animation: 'workbench-spin 2s infinite linear' }}
        />
      )
    case 'streaming':
      return (
        <OLIconButton
          {...props}
          type="submit"
          icon="stop"
          variant="ghost"
          className="workbench-submit-active"
        />
      )
    case 'error':
      return <OLIconButton {...props} type="submit" icon="error" variant="danger" />
    default:
      return <OLIconButton {...props} type="submit" icon="send" variant="ghost" />
  }
}

/** Attach-file button. */
const AttachButton = () => {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  return (
    <OLTooltip id="chat-prompt-attach-file" description={t('attach_image_or_pdf')}>
      <OLIconButton
        icon="attach_file"
        variant="ghost"
        onClick={(e: React.MouseEvent) => {
          e.preventDefault()
          attachments.openFileDialog()
          sendMB('ai-chat', { type: 'message', action: 'attach-file' })
        }}
      />
    </OLTooltip>
  )
}

/** A tool on/off row inside the tools menu. */
const ToolMenuItem = ({
  tool,
  label,
  description,
  className,
}: {
  tool: string
  label: string
  description?: string
  className?: string
}) => {
  const { enabledTools, toggleTool } = useWorkbenchSettings()
  const switchId = useId()
  const checked = enabledTools.has(tool)
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      toggleTool(tool)
    },
    [toggleTool, tool]
  )
  const handleChange = useCallback(
    (event: React.ChangeEvent) => {
      event.stopPropagation()
      toggleTool(tool)
    },
    [toggleTool, tool]
  )
  return (
    <li role="none">
      <DropdownItem
        as="button"
        role="menuitemcheckbox"
        aria-checked={checked}
        className={classNames('w-100', className)}
        onClick={handleClick}
        trailingIcon={
          <OLFormSwitch
            id={`workbench-tools-switch-${switchId}`}
            label={label}
            checked={checked}
            onChange={handleChange}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          />
        }
      >
        <div className="d-flex align-items-center justify-content-between gap-3 w-100 me-5">
          <div className="d-flex flex-column flex-grow-1">
            <span>{label}</span>
            {description && <span className="text-muted small">{description}</span>}
          </div>
        </div>
      </DropdownItem>
    </li>
  )
}

const ToolsMenuToggle = forwardRef<HTMLButtonElement, any>(
  function ToolsMenuToggle({ className, onClick }, ref) {
    return (
      <OLIconButton
        ref={ref}
        onClick={onClick}
        icon="build"
        variant="ghost"
        accessibilityLabel="Open tools menu"
        className={classNames('dropdown-toggle dropdown-no-arrow', className)}
      />
    )
  }
)

/** Tools dropdown. */
const ToolsMenu = () => {
  const [show, setShow] = useState(false)
  return (
    <Dropdown align="end" autoClose="outside" show={show} onToggle={open => setShow(open)}>
      <OLTooltip id="chat-prompt-tools" description="Tools">
        <span>
          <DropdownToggle as={ToolsMenuToggle} id="chat-prompt-tools-toggle" />
        </span>
      </OLTooltip>
      <DropdownMenu className="workbench-tools-menu">
        <DropdownHeader className="workbench-menu-header">Tools</DropdownHeader>
        <ToolMenuItem
          tool="search_publications_dimensions"
          label="Publications"
          description="Search in Dimensions"
        />
        <ToolMenuItem tool="code_interpreter" label="Code" description="Execute Python code" />
        <ToolMenuItem tool="image_generation" label="Images" description="Generate images" />
        <ToolMenuItem
          tool="search_documentation"
          label="Documentation"
          description="Help with Overleaf"
        />
        <ToolMenuItem tool="web_search" label="Web" description="Read online content" />
      </DropdownMenu>
    </Dropdown>
  )
}

const SPEECH_PHRASES = [
  { phrase: 'latex', boost: 5 },
  { phrase: 'tex', boost: 5 },
  { phrase: 'tikz', boost: 5 },
]
const SPEECH_LANG = 'en-US'

/** Web Speech API voice input. */
const SpeechButton = ({
  onStart,
  onTranscriptionChange,
  accessibilityLabel,
  value,
  ...props
}: {
  onStart: () => void
  onTranscriptionChange: (text: string) => void
  accessibilityLabel: string
  value: string
} & any) => {
  const [status, setStatus] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)
  const baseValueRef = useRef(value)
  const lastValueRef = useRef(value)

  const createRecognition = useCallback(async () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onstart = () => {
      onStart()
      setStatus(recognition.processLocally ? 'local' : 'remote')
    }
    recognition.onspeechend = () => {
      recognitionRef.current?.stop()
      setStatus(null)
    }
    recognition.onresult = (event: any) => {
      const text = [
        baseValueRef.current,
        ...Array.from(event.results ?? []).map((result: any) => result[0].transcript),
      ].join(' ')
      lastValueRef.current = text
      onTranscriptionChange(text)
    }
    recognition.onerror = (event: any) => {
      debugConsole.error('Speech recognition error:', event.error)
      if (event.error !== 'no-speech') {
        setStatus('error')
      }
    }
    const configureLocal = () => {
      recognition.processLocally = true
      recognition.phrases = SPEECH_PHRASES.map(
        ({ phrase, boost }) => new (window as any).SpeechRecognitionPhrase(phrase, boost)
      )
    }
    if ('available' in SpeechRecognition) {
      const options = { langs: [SPEECH_LANG], processLocally: true }
      const availability = await SpeechRecognition.available(options)
      switch (availability) {
        case 'unavailable':
          debugConsole.error(`${SPEECH_LANG} not available to download at this time`)
          break
        case 'available':
          configureLocal()
          debugConsole.log('Speech recognition ready')
          break
        case 'downloadable':
        case 'downloading':
          debugConsole.log(`${SPEECH_LANG} language pack downloading`)
          setStatus('downloading')
          if (!(await SpeechRecognition.install(options))) {
            debugConsole.error(`${SPEECH_LANG} language pack failed to download`)
            return null
          }
          debugConsole.log(`${SPEECH_LANG} language pack downloaded`)
          configureLocal()
          debugConsole.log('Speech recognition ready')
          break
        default:
          debugConsole.log(`Unknown result ${availability}`)
      }
    }
    return recognition
  }, [onStart, onTranscriptionChange])

  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value
      recognitionRef.current?.stop()
    }
  }, [value])

  useEffect(
    () => () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    },
    []
  )

  const handleClick = useCallback(async () => {
    if (status) {
      lastValueRef.current = value
      recognitionRef.current?.stop()
      return
    }
    recognitionRef.current = await createRecognition()
    if (recognitionRef.current) {
      lastValueRef.current = value
      baseValueRef.current = value
      recognitionRef.current.start()
    }
  }, [createRecognition, value, status])

  return (
    <OLIconButton
      {...props}
      icon="mic"
      variant={
        status === 'error'
          ? 'danger-ghost'
          : status === 'downloading'
            ? 'secondary'
            : status === 'local' || status === 'remote'
              ? 'primary'
              : 'ghost'
      }
      accessibilityLabel={accessibilityLabel}
      onClick={handleClick}
    />
  )
}

const ModelsMenuToggle = forwardRef<HTMLButtonElement, any>(
  function ModelsMenuToggle({ className, onClick }, ref) {
    return (
      <OLIconButton
        ref={ref}
        onClick={onClick}
        icon="robot_2"
        variant="ghost"
        accessibilityLabel="Open models menu"
        className={classNames('dropdown-toggle dropdown-no-arrow', className)}
      />
    )
  }
)

// Groups displayed in the model picker.
const MODEL_GROUPS: { label: string; models: [string, string][] }[] = [
  {
    label: 'Vertex',
    models: [
      ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro'],
      ['gemini-3-flash-preview', 'Gemini 3 Flash'],
      ['gemini-3.1-flash-lite-preview', 'Gemini 3.1 Flash Lite'],
    ],
  },
  {
    label: 'OpenAI',
    models: [
      ['gpt-5.4', 'GPT 5.4'],
      ['gpt-5.4-mini', 'GPT 5.4 Mini'],
      ['gpt-5.4-nano', 'GPT 5.4 Nano'],
      ['gpt-5.3-codex', 'GPT 5.3 Codex'],
      ['gpt-5.3-chat-latest', 'GPT 5.3 Instant'],
      ['', 'GPT 5.2'],
      ['gpt-5.2-codex', 'GPT 5.2 Codex'],
      ['gpt-5.1', 'GPT 5.1'],
      ['gpt-5-mini', 'GPT 5 Mini'],
      ['gpt-5-nano', 'GPT 5 Nano'],
    ],
  },
]

/** Models dropdown. */
const ModelsMenu = () => {
  const [show, setShow] = useState(false)
  const { model, setModel } = useWorkbenchSettings()
  return (
    <Dropdown align="end" autoClose="outside" show={show} onToggle={open => setShow(open)}>
      <OLTooltip id="chat-prompt-models" description="Models">
        <span>
          <DropdownToggle as={ModelsMenuToggle} id="chat-prompt-models-toggle" />
        </span>
      </OLTooltip>
      <DropdownMenu className="workbench-model-menu">
        {MODEL_GROUPS.map(({ label, models }) => (
          <span key={label}>
            <DropdownHeader className="workbench-menu-header">{label}</DropdownHeader>
            <div className="p-2">
              {models.map(([value, name]) => (
                <Form.Check
                  type="radio"
                  id={`model-${value}`}
                  name="model"
                  value={value}
                  label={name}
                  checked={model === value}
                  onChange={() => {
                    setModel(value)
                  }}
                  key={value}
                />
              ))}
            </div>
          </span>
        ))}
      </DropdownMenu>
    </Dropdown>
  )
}

export type EditorSelectionRange = {
  fromLine: number
  toLine: number
  content: string
  empty: boolean
}

/** The assembled prompt input. */
export const PromptInput = forwardRef<
  HTMLTextAreaElement,
  {
    status: string
    onSend: (payload: PromptSubmitPayload) => void
    onStop: () => void
    setError: (error: string | false) => void
    className?: string
    currentPath?: string
    editorSelectionRanges?: EditorSelectionRange[]
  }
>(function PromptInput(
  {
    status,
    onSend,
    onStop,
    setError,
    className,
    currentPath,
    editorSelectionRanges,
  },
  ref
) {
  const { t } = useTranslation()
  const api = usePromptInput()
  const attachments = usePromptInputAttachments()

  const handleStop = useCallback(
    async (event: React.MouseEvent) => {
      if (status === 'streaming' || status === 'submitted') {
        event.preventDefault()
        await onStop()
      }
    },
    [onStop, status]
  )

  const showSelection =
    currentPath != null &&
    editorSelectionRanges &&
    editorSelectionRanges.some(range => !range.empty)

  const { alphaProgram } = getMeta('ol-user')

  const handleTranscription = useCallback(
    (text: string) => {
      api.textInput.setInput(text)
    },
    [api]
  )

  const focusTextarea = useCallback(() => {
    const textarea = (ref as RefObject<HTMLTextAreaElement>)?.current
    if (textarea) {
      textarea.focus()
      const { length } = textarea.value
      textarea.setSelectionRange(length, length)
    }
  }, [ref])

  const speechAvailable =
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window

  return (
    <PromptInputForm
      onSubmit={async payload => {
        switch (status) {
          case 'streaming':
          case 'submitted':
            return false
          case 'error':
          case 'ready':
            if (payload.text?.trim()) {
              onSend(payload)
              api.textInput.clear()
              const textareaRef = ref as RefObject<HTMLTextAreaElement>
              textareaRef.current?.blur()
              return true
            }
        }
      }}
      setError={setError}
      multiple
      accept="image/*"
      className={classNames('my-1 p-2 workbench-prompt-input', className)}
    >
      {(showSelection || attachments.files.length > 0) && (
        <div className="d-flex flex-wrap gap-2 pt-1 ps-1">
          {showSelection && (
            <EditorSelectionAttachment
              currentPath={currentPath!}
              editorSelectionRanges={editorSelectionRanges!}
            />
          )}
          {attachments.files.map(file => (
            <AttachmentChip data={file} key={file.id} />
          ))}
        </div>
      )}
      <div>
        <PromptTextarea ref={ref} placeholder={t('what_would_you_like_to_do')} />
      </div>
      <div className="d-flex align-items-end justify-content-between gap-2">
        <div className="d-flex align-items-center gap-2">
          <AttachButton />
          {alphaProgram && <ToolsMenu />}
          {alphaProgram && <ModelsMenu />}
        </div>
        <div className="d-flex align-items-center gap-2">
          {alphaProgram && (
            <OLTooltip
              id="chat-prompt-voice-input"
              description={
                speechAvailable ? t('speak') : t('speech_input_not_available')
              }
            >
              <span>
                <SpeechButton
                  onStart={focusTextarea}
                  value={api.textInput.value}
                  onTranscriptionChange={handleTranscription}
                  accessibilityLabel={t('speak')}
                  disabled={!speechAvailable}
                />
              </span>
            </OLTooltip>
          )}
          <OLTooltip
            id="chat-prompt-send-message"
            description={
              status === 'error'
                ? t('error')
                : status === 'ready'
                  ? t('send')
                  : t('stop')
            }
          >
            <span>
              <SubmitButton
                status={status}
                onClick={handleStop}
                disabled={status === 'ready' && api.textInput.value.length === 0}
              />
            </span>
          </OLTooltip>
        </div>
      </div>
    </PromptInputForm>
  )
})
