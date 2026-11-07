import { Tooltip } from 'bootstrap'

function getElementWidth(el: Element) {
  const elComputedStyle = window.getComputedStyle(el)
  const elPaddingX =
    parseFloat(elComputedStyle.paddingLeft) +
    parseFloat(elComputedStyle.paddingRight)
  const elBorderX =
    parseFloat(elComputedStyle.borderLeftWidth) +
    parseFloat(elComputedStyle.borderRightWidth)
  return el.scrollWidth - elPaddingX - elBorderX
}

const visibleInstances = new Set<Tooltip>()

function handleEscapeKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    visibleInstances.forEach(instance => instance.hide())
    e.stopPropagation()
  }
}

function createTooltip(element: Element): Tooltip {
  const instance = new Tooltip(element)
  element.addEventListener('show.bs.tooltip', () => {
    if (visibleInstances.size === 0) {
      document.addEventListener('keydown', handleEscapeKey, { capture: true })
    }
    visibleInstances.add(instance)
  })
  element.addEventListener('hide.bs.tooltip', () => {
    visibleInstances.delete(instance)
    if (visibleInstances.size === 0) {
      document.removeEventListener('keydown', handleEscapeKey, {
        capture: true,
      })
    }
  })
  return instance
}

const footerLanguageElement = document.querySelector(
  '[data-ol-lang-selector-tooltip]'
) as Element
if (footerLanguageElement) {
  createTooltip(footerLanguageElement)
}

const allTooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]')
allTooltips.forEach(element => {
  createTooltip(element)
})

const possibleBadgeTooltips = document.querySelectorAll('[data-badge-tooltip]')
possibleBadgeTooltips.forEach(element => {
  // Put data-badge-tooltip on .badge-content
  // then tooltip is only shown if content is clipped due to max-width on .badge
  // Due to font loading, the width calculated on page load might change, so we might
  // incorrectly determine a tooltip is not needed. This is why max-width will always be set to none
  // if no tooltip is shown so that content is fully visible in those scenarios.

  if (element.parentElement) {
    const parentWidth = getElementWidth(element.parentElement)
    if (element.scrollWidth > parentWidth) {
      createTooltip(element)
    } else {
      element.parentElement.style.maxWidth = 'none'
    }
  }
})
