// This file is shared between the frontend and server code of web, so that
// filename validation is the same in both implementations.
// The logic in all copies must be kept in sync:
//   app/src/Features/Project/SafePath.js
//   frontend/js/ide/directives/SafePath.js
//   frontend/js/features/file-tree/util/safe-path.js
// eslint-disable-next-line prefer-regex-literals
const BADCHAR_RX = new RegExp(
  `\
[\
\\/\
\\\\\
\\*\
\\u0000-\\u001F\
\\u007F\
\\u0080-\\u009F\
\\uD800-\\uDFFF\
]\
`,
  'g'
)
// eslint-disable-next-line prefer-regex-literals
const BADFILE_RX = new RegExp(
  `\
(^\\.$)\
|(^\\.\\.$)\
|(^\\s+)\
|(\\s+$)\
`,
  'g'
)

// Put a block on filenames which match javascript property names, as they
// can cause exceptions where the code puts filenames into a hash. This is a
// temporary workaround until the code in other places is made safe against
// property names.
//
// The list of property names is taken from
//   ['prototype'].concat(Object.getOwnPropertyNames(Object.prototype))
// eslint-disable-next-line prefer-regex-literals
const BLOCKEDFILE_RX = new RegExp(`\
^(\
prototype\
|constructor\
|toString\
|toLocaleString\
|valueOf\
|hasOwnProperty\
|isPrototypeOf\
|propertyIsEnumerable\
|__defineGetter__\
|__lookupGetter__\
|__defineSetter__\
|__lookupSetter__\
|__proto__\
)$\
`)

// Names that turn into ".." in a URL: each dot may be "%2e", a "?" or "#"
// may follow, and "%2f"/"%5c" act as separators once a server decodes them.
// Keep in sync with hasTraversal in libraries/validation-tools.
const DOUBLE_DOT_SEGMENT_RX = /^(?:\.|%2e){2}(?:[?#]| *$)/i
const ENCODED_SEPARATOR_RX = /%2f|%5c/i

function hasEncodedTraversal(filename: string): boolean {
  return filename
    .split(ENCODED_SEPARATOR_RX)
    .some(segment => DOUBLE_DOT_SEGMENT_RX.test(segment))
}

const MAX_PATH = 1024 // Maximum path length, in characters. This is fairly arbitrary.

export function isCleanFilename(filename: string): boolean {
  return (
    isAllowedLength(filename) &&
    !filename.match(BADCHAR_RX) &&
    !filename.match(BADFILE_RX) &&
    !hasEncodedTraversal(filename)
  )
}

export function isBlockedFilename(filename: string): boolean {
  return BLOCKEDFILE_RX.test(filename)
}

export function isAllowedLength(pathname: string): boolean {
  return pathname.length > 0 && pathname.length <= MAX_PATH
}
