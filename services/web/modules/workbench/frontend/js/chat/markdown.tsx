/**
 * Renders model output as Markdown while it streams: math through KaTeX,
 * CJK-aware emphasis, sanitized HTML, and highlighted code with a copy button.
 */
import { memo, useEffect, useId, useMemo, useState } from 'react'
import { visit } from 'unist-util-visit'
import { throttle } from 'lodash'
import { Streamdown, defaultRemarkPlugins } from 'streamdown'
import { createMathPlugin } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { harden } from 'rehype-harden'
import { PrismLight } from 'react-syntax-highlighter'
// eslint-disable-next-line import/no-unresolved
import latexGrammar from 'react-syntax-highlighter/dist/esm/languages/prism/latex'
// eslint-disable-next-line import/no-unresolved
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
// @streamdown/math does not bring the KaTeX stylesheet
import 'katex/dist/katex.min.css'
import { useTranslation } from 'react-i18next'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import { framed, link, muted } from './themed'

PrismLight.registerLanguage('latex', latexGrammar)

// Inline $...$ is off by default (it could be a price); models use it for math
const math = createMathPlugin({ singleDollarTextMath: true })

// Some providers wrap citations in private-use characters: cite...
const PROVIDER_CITATION = /cite.+?/gu

function dropProviderCitations() {
  return (tree: any) =>
    visit(tree, 'text', (node: any) => {
      node.value = node.value.replace(PROVIDER_CITATION, '')
    })
}

const REMARK = [...Object.values(defaultRemarkPlugins), dropProviderCitations]

const REHYPE = [
  [
    rehypeSanitize,
    {
      ...defaultSchema,
      attributes: {
        ...defaultSchema.attributes,
        // keep the language of fenced code and the math markers
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

/** Index of the $ that closes inline math opened before from, or -1. */
function closingDollar(text: string, from: number) {
  for (let at = from; at < text.length; at++) {
    if (text[at] === '\\') at++
    else if (text[at] === '\n' && text[at + 1] === '\n') return -1
    else if (text[at] === '$') return text[at + 1] === '$' ? -1 : at
  }
  return -1
}

/**
 * Pandoc's rule for $...$: the opening $ is followed by a non-space, the
 * closing one follows a non-space and is not followed by a digit. Any other
 * single $ is escaped, so "$5 and $10" stays text.
 */
function escapeStrayDollars(text: string) {
  let out = ''
  for (let at = 0; at < text.length; ) {
    const char = text[at]
    if (char === '\\') {
      out += text.slice(at, at + 2)
      at += 2
    } else if (char !== '$') {
      out += char
      at++
    } else if (text[at + 1] === '$') {
      const end = text.indexOf('$$', at + 2)
      const stop = end === -1 ? text.length : end + 2
      out += text.slice(at, stop)
      at = stop
    } else {
      const close = closingDollar(text, at + 1)
      const isMath =
        close !== -1 &&
        /\S/.test(text[at + 1]) &&
        /\S/.test(text[close - 1]) &&
        !/\d/.test(text[close + 1] ?? '')
      out += isMath ? text.slice(at, close + 1) : '\\$'
      at = isMath ? close + 1 : at + 1
    }
  }
  return out
}

/**
 * remark-math only knows $...$ and $$...$$; models often write \(...\) and
 * \[...\]. Code spans and fenced blocks are left alone.
 */
function dollarMath(markdown: string) {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((chunk, index) =>
      index % 2
        ? chunk
        : escapeStrayDollars(
            chunk
              // $$...$$ alone on a line is a displayed formula, but
              // remark-math only takes it as one with $$ on lines of their own
              .replace(/^[ \t]*\$\$([^\n$]+)\$\$[ \t]*$/gm, (_, tex) => `$$\n${tex.trim()}\n$$`)
              .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => `\n\n$$\n${tex.trim()}\n$$\n\n`)
              .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => `$${tex.trim()}$`)
          )
    )
    .join('')
}

/**
 * Copies the code. The core CopyToClipboard draws its icon in the link color
 * and takes no class; this one takes the color of the text around it.
 */
function CopyCode({ code }: { code: string }) {
  const { t } = useTranslation()
  const tooltipId = useId()
  const [copied, setCopied] = useState(false)
  if (!navigator.clipboard?.writeText) return null
  const copy = () =>
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  return (
    <OLTooltip id={tooltipId} description={copied ? `${t('copied')}!` : t('copy')}>
      <button
        type="button"
        className="btn btn-link btn-sm p-0 text-reset d-inline-flex"
        aria-label={t('copy')}
        onClick={copy}
      >
        <MaterialIcon type={copied ? 'check' : 'content_copy'} unfilled />
      </button>
    </OLTooltip>
  )
}

const CodeBlock = memo(function CodeBlock({ language, code }: { language: string; code: string }) {
  const theme = useActiveOverallTheme() === 'dark' ? oneDark : oneLight
  // Highlighting every streamed token is slow; four times a second is enough
  const [shown, setShown] = useState(code)
  const update = useMemo(() => throttle(setShown, 250), [])
  useEffect(() => update(code), [update, code])
  return (
    <div className="position-relative rounded p-2 pe-5 my-2" style={{ ...framed, fontSize: 'var(--font-size-01)' }}>
      <div className="position-absolute top-0 end-0 m-1">
        <CopyCode code={code} />
      </div>
      <PrismLight
        language={language}
        style={theme}
        PreTag="div"
        wrapLongLines
        customStyle={{ margin: 0, padding: 0, background: 'none' }}
      >
        {shown}
      </PrismLight>
    </div>
  )
})

// Streamdown sizes headings with Tailwind classes, which this app does not
// have; these use the editor's type scale instead
const heading =
  (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', size: string, height: string) =>
  ({ node, className, ...props }: any) => (
    <Tag
      {...props}
      className="fw-semibold mb-0 mt-1"
      style={{ fontSize: `var(${size})`, lineHeight: `var(${height})`, color: 'inherit' }}
    />
  )

const COMPONENTS = {
  // Blocks are spaced by the gap of the wrapper, not by their own margins
  p: ({ node, ...props }: any) => <p {...props} className="mb-0" />,
  hr: ({ node, ...props }: any) => <hr {...props} className="my-1" />,
  h1: heading('h1', '--font-size-05', '--line-height-04'),
  h2: heading('h2', '--font-size-04', '--line-height-03'),
  h3: heading('h3', '--font-size-03', '--line-height-02'),
  h4: heading('h4', '--font-size-02', '--line-height-01'),
  h5: heading('h5', '--font-size-02', '--line-height-01'),
  h6: heading('h6', '--font-size-02', '--line-height-01'),
  a: ({ children, node, ...props }: any) => (
    <a {...props} style={link} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  table: ({ children, node, ...props }: any) => (
    <div className="overflow-auto">
      <table {...props}>{children}</table>
    </div>
  ),
  code({ className, children, node, ...props }: any) {
    const language = /language-(\w+)/.exec(className ?? '')?.[1]
    if (language) {
      return <CodeBlock language={language} code={String(children ?? '')} />
    }
    // Inline code at the size of the text around it, in the secondary text color
    return (
      <code className={className} style={{ ...muted, fontSize: '1em' }} {...props}>
        {children}
      </code>
    )
  },
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const source = useMemo(() => dollarMath(text ?? ''), [text])
  // Text parts around tool calls are often only line breaks; they would
  // still take up a gap in the message
  if (!source.trim()) return null
  return (
    // text-break would also split KaTeX output; break only what overflows
    <div style={{ overflowWrap: 'break-word' }}>
      <Streamdown
        className="d-flex flex-column gap-2"
        plugins={{ math, cjk }}
        components={COMPONENTS}
        remarkPlugins={REMARK as any}
        rehypePlugins={REHYPE as any}
        remarkRehypeOptions={{ allowDangerousHtml: false }}
      >
        {source}
      </Streamdown>
    </div>
  )
})

export default Markdown
