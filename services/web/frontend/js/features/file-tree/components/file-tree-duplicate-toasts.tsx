import { GlobalToastGeneratorEntry } from '@/features/ide-react/components/global-toasts'
import { useTranslation } from 'react-i18next'

const DuplicatedToast = ({ data }: { data?: any }) => {
  const { t } = useTranslation()
  return <span>{t('duplicate_created', { name: data?.name })}</span>
}

const DuplicateErrorToast = ({ data }: { data?: any }) => {
  const { t } = useTranslation()
  return (
    <>
      <span>{t('duplicate_failed')}</span>
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
    key: 'file-tree:duplicate-done',
    generator: (data: any) => ({
      content: <DuplicatedToast data={data} />,
      type: 'success',
      autoHide: true,
      delay: 6000,
      isDismissible: true,
    }),
  },
  {
    key: 'file-tree:duplicate-error',
    generator: (data: any) => ({
      content: <DuplicateErrorToast data={data} />,
      type: 'error',
      autoHide: true,
      delay: 8000,
      isDismissible: true,
    }),
  },
]

export default generators

export const showFileDuplicated = (name: string) => {
  window.dispatchEvent(
    new CustomEvent('ide:show-toast', {
      detail: { key: 'file-tree:duplicate-done', name },
    })
  )
}

export const showFileDuplicateError = (message?: string) => {
  window.dispatchEvent(
    new CustomEvent('ide:show-toast', {
      detail: { key: 'file-tree:duplicate-error', message },
    })
  )
}
