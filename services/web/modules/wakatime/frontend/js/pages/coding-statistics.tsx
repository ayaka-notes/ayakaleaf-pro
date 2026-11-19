import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import CodingStatisticsRoot from '../components/coding-statistics-root'
import '../../stylesheets/coding-statistics.scss'

// renderInReactLayout also mounts the site navbar and footer, like the
// account settings page
renderInReactLayout('coding-statistics-root', () => <CodingStatisticsRoot />)
