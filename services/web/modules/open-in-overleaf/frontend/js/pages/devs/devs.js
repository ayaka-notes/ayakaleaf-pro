// /devs "Overleaf API" documentation page.
//
// openInOverleaf() is the exact snippet published on the page (and on
// www.overleaf.com/devs), so what visitors copy is what runs here: it walks the
// DOM of the code box (<br> -> newline, which innerText/textContent get wrong
// across browsers), URL-encodes the source into #ol_encoded_snip and submits
// the single shared #ol_form to POST /docs.
import '../../../../../../frontend/js/marketing'

function openInOverleaf(a) {
  function unformat(e) {
    var ret = ''
    if (e.nodeType === 1) {
      // element node
      if (e.tagName === 'BR') {
        return '\n'
      } else {
        for (e = e.firstChild; e; e = e.nextSibling) {
          ret += unformat(e)
        }
        return ret
      }
    } else if (e.nodeType === 3 || e.nodeType === 4) {
      // text node
      return e.nodeValue
    }
  }
  var code = a.parentNode.parentNode.getElementsByTagName('CODE')[0]
  document.getElementById('ol_encoded_snip').value = encodeURIComponent(
    unformat(code)
  )
  document.getElementById('ol_form').submit()
}

// Light-weight LaTeX highlighting for the code boxes (the official page uses
// highlight.js). Wrapping tokens in spans is safe for openInOverleaf(): unformat()
// walks the DOM and concatenates the text nodes.
function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightLatex(code) {
  return escapeHtml(code)
    .replace(/(%[^\n]*)/g, '<span class="hl-comment">$1</span>')
    .replace(/(\\[A-Za-z@]+\*?)/g, '<span class="hl-command">$1</span>')
    .replace(/([{}[\]])/g, '<span class="hl-brace">$1</span>')
}

document.addEventListener('DOMContentLoaded', () => {
  for (const code of document.querySelectorAll('.codebox code')) {
    code.innerHTML = highlightLatex(code.textContent)
  }
})

window.openInOverleaf = openInOverleaf
