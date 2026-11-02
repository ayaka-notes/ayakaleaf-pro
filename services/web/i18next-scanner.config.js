const fs = require('node:fs')
const path = require('node:path')
const typescript = require('typescript')

module.exports = {
  input: [
    'frontend/js/**/*.{js,jsx,ts,tsx}',
    'modules/*/frontend/js/**/*.{js,jsx,ts,tsx}',
    // vendored module deps (modules/<mod>/deps/<dep>/...) live one level
    // deeper than the plain module glob above — cover both layouts
    'modules/*/deps/*/frontend/js/**/*.{js,jsx,ts,tsx}',
    'modules/*/deps/*/js/**/*.{js,jsx,ts,tsx}',
    '!frontend/js/vendor/**',
    '!modules/writefull/frontend/js/integration/**',
  ],
  output: './',
  options: {
    sort: true,
    // Extract keys verbatim: the app uses flat string keys (i18next v3
    // compatibility mode), so a dot inside a string is text, NOT a key-path
    // separator. With the default '.' separator the scanner split strings
    // like 'e.g. Jane Smith' / 'Paste BibTeX or DOIs here.' / 'Upload .bib file'
    // into nested fragments — the loader then dropped the real keys and the UI
    // rendered the raw key text.
    keySeparator: false,
    nsSeparator: false,
    func: {
      list: ['t', 'phrase'],
      extensions: ['.js', '.jsx'],
    },
    trans: {
      component: 'Trans',
      i18nKey: 'i18nKey',
      defaultsKey: 'defaults',
      extensions: ['.js', '.jsx'],
      fallbackKey: false,
    },
    resource: {
      savePath: 'frontend/extracted-translations.json',
      jsonIndent: 2,
      lineEnding: '\n',
    },
  },
  // adapted from https://github.com/nucleartux/i18next-scanner-typescript/blob/master/src/index.js
  transform: function (file, enc, done) {
    const { base, ext } = path.parse(file.path)

    if (['.ts', '.tsx'].includes(ext) && !base.endsWith('.d.ts')) {
      let content = fs.readFileSync(file.path, enc)

      // plural(t, count, 'singular_key', 'plural_key') passes its keys as plain
      // string args — outside i18next-scanner's t()/phrase() literal capture
      // (the build then drops them from the bundled locale data, so the UI
      // would render the raw key, e.g. "many_references"). Rewrite the call
      // shape for the scanner only, so BOTH keys are extracted as t() literals.
      content = content.replace(
        /plural\(\s*t\s*,[^,)]+\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g,
        (all, a, b) => `t('${a}') /*scanner*/ t('${b}') /*scanner*/` + all
      )

      const { outputText } = typescript.transpileModule(content, {
        compilerOptions: { target: 'es2018', jsx: 'preserve' },
        fileName: base,
      })

      this.parser.parseTransFromString(outputText)
      this.parser.parseFuncFromString(outputText)
    }

    done()
  },
}
