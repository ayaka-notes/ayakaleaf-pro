import { GlobalToastGeneratorEntry } from '@/features/ide-react/components/global-toasts'
import { useTranslation } from 'react-i18next'

const ConvertedToast = ({ data }: { data?: any }) => {
  const { t } = useTranslation()
  return <span>{t('svg_convert_done', { name: data?.name })}</span>
}

const ConvertErrorToast = ({ data }: { data?: any }) => {
  const { t } = useTranslation()
  return (
    <>
      <span>{t('svg_convert_failed')}</span>
      {typeof data?.message === 'string' && (
        <details style={{ marginTop: 4 }}>
          <summary>{t('conversion_error_details')}</summary>
          <code style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {data.message}
          </code>
        </details>
      )}
    </>
  )
}

const generators: GlobalToastGeneratorEntry[] = [
  {
    key: 'svgeditor:conversion-done',
    generator: (data: any) => ({
      content: <ConvertedToast data={data} />,
      type: 'success',
      autoHide: true,
      delay: 6000,
      isDismissible: true,
    }),
  },
  {
    key: 'svgeditor:conversion-error',
    generator: (data: any) => ({
      content: <ConvertErrorToast data={data} />,
      type: 'error',
      autoHide: true,
      delay: 8000,
      isDismissible: true,
    }),
  },
]

export default generators

export const showSvgConversionDone = (name: string) => {
  window.dispatchEvent(
    new CustomEvent('ide:show-toast', {
      detail: { key: 'svgeditor:conversion-done', name },
    })
  )
}

export const showSvgConversionError = (message?: string) => {
  window.dispatchEvent(
    new CustomEvent('ide:show-toast', {
      detail: { key: 'svgeditor:conversion-error', message },
    })
  )
}
