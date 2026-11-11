const SYSTEM_THEME_USER_CUTOFF_DATE = new Date(Date.UTC(2026, 2, 2, 12, 0, 0)) // 12pm GMT on March 2, 2026

// Default comment tags highlighted in the source editor, in priority order
// (the first matching tag's colour wins for a given line).
const DEFAULT_HIGHLIGHT_TAGS = [
  { tag: 'TODO', color: '#ff8c00' },
  { tag: 'FIXME', color: '#e5484d' },
  { tag: 'BUG', color: '#8b5cf6' },
  { tag: 'CITATION', color: '#3b82f6' },
]

/**
 * Normalise the stored `user.ace.highlight` value to an array of
 * `{ tag, color }` entries, falling back to the defaults when unset or empty.
 * Also migrates the previous single-`{ tag, color }` shape to a one-entry
 * array so nothing is lost.
 */
function buildHighlightTags(highlight) {
  if (Array.isArray(highlight)) {
    const tags = highlight
      .filter(entry => entry && typeof entry.tag === 'string' && entry.tag.trim() !== '')
      .map(entry => ({
        tag: entry.tag,
        color: typeof entry.color === 'string' ? entry.color : '#ff8c00',
      }))
    return tags.length > 0 ? tags : DEFAULT_HIGHLIGHT_TAGS
  }
  if (
    highlight != null &&
    typeof highlight === 'object' &&
    typeof highlight.tag === 'string'
  ) {
    return [
      {
        tag: highlight.tag,
        color:
          typeof highlight.color === 'string' ? highlight.color : '#ff8c00',
      },
    ]
  }
  return DEFAULT_HIGHLIGHT_TAGS
}

function getOverallTheme(user) {
  if (user.ace.overallTheme != null) {
    return user.ace.overallTheme
  }

  if (user.signUpDate < SYSTEM_THEME_USER_CUTOFF_DATE) {
    // default / dark
    return ''
  }

  return 'system'
}

/**
 * Build the settings for a reference provider (zotero, mendeley, papers).
 *
 * The group entries are rebuilt explicitly so that the `_id` stored on older
 * documents doesn't leak to the frontend, which posts these settings back to us
 * unchanged.
 *
 * @param {object | undefined} settings the provider settings from `user.ace`
 */
function buildRefProviderSettings(settings) {
  if (settings == null) {
    return settings
  }
  return {
    enabled: settings.enabled,
    disablePersonalLibrary: settings.disablePersonalLibrary,
    groups: (settings.groups ?? []).map(group => ({ id: group.id })),
  }
}

function getInitialTheme(overallThemeSetting) {
  switch (overallThemeSetting) {
    case 'light-':
      return 'light'
    case '':
      return 'dark'
    case 'system':
      return 'system'
    default:
      return 'dark'
  }
}

async function buildUserSettings(_req, _res, user) {
  return {
    mode: user.ace.mode,
    editorTheme: user.ace.theme,
    editorLightTheme: user.ace.lightTheme,
    editorDarkTheme: user.ace.darkTheme,
    fontSize: user.ace.fontSize,
    autoComplete: user.ace.autoComplete,
    autoPairDelimiters: user.ace.autoPairDelimiters,
    pdfViewer: user.ace.pdfViewer,
    syntaxValidation: user.ace.syntaxValidation,
    previewTabs: user.ace.previewTabs ?? false,
    fontFamily: user.ace.fontFamily || 'lucida',
    lineHeight: user.ace.lineHeight || 'normal',
    overallTheme: getOverallTheme(user),
    mathPreview: user.ace.mathPreview,
    breadcrumbs: user.ace.breadcrumbs,
    editorTabs: user.ace.editorTabs ?? true,
    nonBlinkingCursor: user.ace.nonBlinkingCursor ?? false,
    referencesSearchMode: user.ace.referencesSearchMode,
    darkModePdf: user.ace.darkModePdf ?? false,
    floatingMenu: user.ace.floatingMenu ?? true,
    highlight: buildHighlightTags(user.ace.highlight),
    zotero: buildRefProviderSettings(user.ace.zotero),
    mendeley: buildRefProviderSettings(user.ace.mendeley),
    papers: buildRefProviderSettings(user.ace.papers),
  }
}

export default {
  buildUserSettings,
  getInitialTheme,
  buildHighlightTags,
  DEFAULT_HIGHLIGHT_TAGS,
}
