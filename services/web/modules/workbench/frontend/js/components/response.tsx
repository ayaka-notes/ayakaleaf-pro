/**
 * Renders streamed Markdown responses with math, source-text cleanup, and
 * syntax-highlighted code blocks. Sanitizes rendered HTML and provides code
 * copy controls.
 */
import { memo, useCallback, useEffect, useId, useMemo, useState } from 'react'
import classNames from 'classnames'
import { visit } from 'unist-util-visit'
// KaTeX styles for rendered math. @streamdown/math renders with KaTeX but does
// not ship its stylesheet, so without this math renders unstyled.
import 'katex/dist/katex.min.css'
import { Streamdown, defaultRemarkPlugins } from 'streamdown'
import { math } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { harden } from 'rehype-harden'
import { throttle } from 'lodash'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
// eslint-disable-next-line import/no-unresolved
import latex from 'react-syntax-highlighter/dist/esm/languages/prism/latex'
// eslint-disable-next-line import/no-unresolved
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import { sendMB } from '@/infrastructure/event-tracking'

SyntaxHighlighter.registerLanguage('latex', latex)

// Strip provider citation markers that the Markdown renderer cannot display.
const CITE_MARKER_RE = /\uE200cite(.+?)\uE201/gu

const remarkPlugins = [
  ...Object.values(defaultRemarkPlugins),
  () => (tree: any) => {
    visit(tree, 'text', (node: any) => {
      if (CITE_MARKER_RE.test(node.value)) {
        node.value = node.value.replaceAll(CITE_MARKER_RE, '')
      }
    })
  },
]

const rehypePlugins = [
  [
    rehypeSanitize,
    {
      ...defaultSchema,
      attributes: {
        ...defaultSchema.attributes,
        code: [['className', /^language-./, 'math-inline', 'math-display']],
      },
    },
  ],
  math.rehypePlugin,
  [
    harden,
    {
      allowedProtocols: ['http', 'https'],
      allowedLinkPrefixes: ['*'],
      allowedImagePrefixes: [],
      allowDataImages: true,
    },
  ],
]

const remarkRehypeOptions = { allowDangerousHtml: false }

// Convert LaTeX math delimiters to the dollar delimiters used by remark-math.
// The split preserves closed triple-backtick fences and single-backtick code spans.
function normalizeMathDelimiters(markdown: string): string {
  if (!markdown || (!markdown.includes('\\[') && !markdown.includes('\\('))) {
    return markdown
  }
  return markdown
    .split(/(```[\s\S]*?```|`[^`]*`)/g)
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      return segment
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, inner) => `\n\n$$\n${inner.trim()}\n$$\n\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, inner) => `$${inner.trim()}$`)
    })
    .join('')
}

export const CodeBlock = memo(function CodeBlock({
  language,
  value,
  className,
}: {
  language: string
  value: string
  className?: string
}) {
  // The rendered value is throttled so syntax highlighting doesn't re-run on
  // every streamed token.
  const [rendered, setRendered] = useState('')
  const overallTheme = useActiveOverallTheme()
  const style = overallTheme === 'dark' ? oneDark : oneLight
  const tooltipId = useId()
  const throttledSet = useMemo(() => throttle(setRendered, 250), [])
  useEffect(() => {
    throttledSet(value)
  }, [throttledSet, value])
  const handleCopy = useCallback(() => {
    sendMB('ai-chat-response', { button: 'copy' })
  }, [])

  return (
    <div className={classNames('workbench-code-block', className)}>
      <span className="workbench-copy-code">
        <CopyToClipboard
          content={rendered}
          tooltipId={tooltipId}
          kind="icon"
          unfilled
          onClick={handleCopy}
        />
      </span>
      <SyntaxHighlighter
        style={style}
        language={language}
        PreTag="div"
        customStyle={{ background: 'transparent', width: '100%' }}
        wrapLongLines
      >
        {rendered}
      </SyntaxHighlighter>
    </div>
  )
})

const markdownComponents = {
  a: ({ children, ...props }: any) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children, ...props }: any) => (
    <div {...props} className="overflow-x-auto">
      {children}
    </div>
  ),
  code({ className, children, ...props }: any) {
    if (!children) {
      return null
    }
    const match = /language-(\w+)/.exec(className || '')
    if (match) {
      return <CodeBlock language={match[1]} value={String(children)} />
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  },
  li({ children }: any) {
    return <li data-streamdown="list-item">{children}</li>
  },
}

export const Response = memo(function Response({
  markdown,
}: {
  markdown: string
}) {
  const normalized = useMemo(
    () => normalizeMathDelimiters(markdown ?? ''),
    [markdown]
  )
  return (
    <Streamdown
      plugins={{ math, cjk }}
      components={markdownComponents}
      remarkPlugins={remarkPlugins as any}
      rehypePlugins={rehypePlugins as any}
      remarkRehypeOptions={remarkRehypeOptions}
    >
      {normalized}
    </Streamdown>
  )
})
