import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import OLFormControl from '@/shared/components/ol/ol-form-control'

// The search box of every admin list; the search itself runs in the backend
function ListSearch({
  initialValue,
  loading,
  onSearch,
  placeholder,
}: {
  initialValue: string
  loading: boolean
  onSearch: (search: string, options: { debounce: boolean }) => void
  // what the search matches, e.g. project name or ID
  placeholder?: string
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState(initialValue)

  return (
    <form
      className="admin-panel-search"
      role="search"
      onSubmit={event => event.preventDefault()}
    >
      <OLFormControl
        type="text"
        value={search}
        placeholder={placeholder ?? t('search')}
        aria-label={t('search')}
        prepend={<MaterialIcon type="search" />}
        loading={loading}
        append={
          search.length > 0 && !loading ? (
            <button
              type="button"
              className="form-control-search-clear-btn"
              onClick={() => {
                setSearch('')
                onSearch('', { debounce: false })
              }}
            >
              <MaterialIcon type="clear" accessibilityLabel={t('clear_search')} />
            </button>
          ) : undefined
        }
        onChange={event => {
          setSearch(event.target.value)
          onSearch(event.target.value.trim(), { debounce: true })
        }}
      />
    </form>
  )
}

export default ListSearch
