import { useTranslation } from 'react-i18next'
import { GlobalToastGeneratorEntry } from '@/features/ide-react/components/global-toasts'

const FormatErrorToast = () => {
  const { t } = useTranslation()
  return <>{t('generic_something_went_wrong')}</>
}

const generators: GlobalToastGeneratorEntry[] = [
  {
    key: 'autoformatter:format-error',
    generator: () => ({
      content: <FormatErrorToast />,
      type: 'warning',
      autoHide: true,
      delay: 6000,
      isDismissible: true,
    }),
  },
]

export default generators

export const showFormatErrorToast = () => {
  window.dispatchEvent(
    new CustomEvent('ide:show-toast', {
      detail: { key: 'autoformatter:format-error' },
    })
  )
}
