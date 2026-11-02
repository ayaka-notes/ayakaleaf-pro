/**
 * /library and /library/trashed page entry (Webpack auto-entry glob
 * `modules/<module>/frontend/js/pages/**`; template-gallery precedent).
 */
import ReactDOM from 'react-dom/client'
import LibraryRoot from '../library/library-root'
import '../../stylesheets/bib-saas.css'
import '../../stylesheets/bib-library.css'

const element = document.getElementById('library-root')
if (element) {
  const root = ReactDOM.createRoot(element)
  root.render(<LibraryRoot />)
}
