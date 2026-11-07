export function ciamIcon(type: 'error' | 'info', className?: string) {
  const elName = type === 'error' ? 'ph-warning-circle' : 'ph-info'
  const icon = document.createElement(elName) as HTMLElement
  if (className) {
    icon.className = className
  }
  icon.ariaHidden = 'true'
  return icon
}
