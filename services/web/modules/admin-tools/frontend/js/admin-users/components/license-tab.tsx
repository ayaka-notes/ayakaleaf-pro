import { Trans, useTranslation } from 'react-i18next'
import { getOptions } from '../meta'

// Upstream's three lines about the license
function LicenseTab() {
  const { t } = useTranslation()
  const { activeUsersCount } = getOptions()

  return (
    <div className="admin-panel-license">
      <p>
        <Trans
          i18nKey="server_pro_license_entitlement_line_1"
          values={{ appName: t('app_name') }}
          components={[<strong />]} // eslint-disable-line react/jsx-key
        />
      </p>
      <p>
        <Trans
          i18nKey="server_pro_license_entitlement_line_2"
          values={{ count: activeUsersCount }}
          // eslint-disable-next-line react/jsx-key
          components={[<strong />, <a href="https://www.overleaf.com/contact" />]}
        />
      </p>
      <p>
        <Trans i18nKey="server_pro_license_entitlement_line_3" />
      </p>
    </div>
  )
}

export default LicenseTab
