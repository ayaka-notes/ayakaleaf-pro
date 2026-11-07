import Settings from '@overleaf/settings'
import Router from './app/src/Router.mjs'


let TemplateGalleryModule = {}

if (process.env.OVERLEAF_TEMPLATE_GALLERY === 'true') {
  TemplateGalleryModule = {
    router: Router,
  }
  Settings.nav.header_extras.push({text: "templates", url: "/templates/all", class: "subdued"})
  
  Settings.templates = {
    user_id: process.env.OVERLEAF_TEMPLATES_USER_ID || '000000000000000000000000',
  }

  const templateKeys = process.env.OVERLEAF_TEMPLATE_CATEGORIES
    ? process.env.OVERLEAF_TEMPLATE_CATEGORIES + ' all'
    : 'all'

  Settings.templateLinks = templateKeys.split(/\s+/).map(key => {
    const envKeyBase = key.toUpperCase().replace(/-/g, "_")
    const name = process.env[`TEMPLATE_${envKeyBase}_NAME`] || ( key === 'all' ? 'All templates' : key)
    const description = process.env[`TEMPLATE_${envKeyBase}_DESCRIPTION`] || ''

    return {
      name,
      url: `/templates/${key}`,
      description
    }
  })
}

export default TemplateGalleryModule
