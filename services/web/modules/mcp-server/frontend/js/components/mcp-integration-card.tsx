import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import {
  Nav,
  NavItem,
  NavLink,
  TabContainer,
  TabContent,
  TabPane,
} from 'react-bootstrap'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import OLButton from '@/shared/components/ol/ol-button'
import { useProjectContext } from '@/shared/context/project-context'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import getMeta from '@/utils/meta'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import McpLogo from './mcp-logo'
import claudeLogo from '../../images/claude.svg'
import codexLogo from '../../images/codex.svg'
import cursorLogo from '../../images/cursor.svg'
import vscodeLogo from '../../images/vscode.svg'
import geminiLogo from '../../images/gemini.svg'

function CopyableCode({
  content,
  className = '',
}: {
  content: string
  className?: string
}) {
  return (
    <div
      className={`git-bridge-copy justify-content-between align-items-start ${className}`}
    >
      <pre
        className="mb-0 flex-grow-1"
        style={{ minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
      >
        <code>{content}</code>
      </pre>
      <span>
        <CopyToClipboard content={content} kind="text" />
      </span>
    </div>
  )
}

function McpModal({
  show,
  projectId,
  handleHide,
}: {
  show: boolean
  projectId: string
  handleHide: () => void
}) {
  const { t } = useTranslation()
  const url = `${window.location.origin}/project/${projectId}/mcp`

  const clients = [
    {
      key: 'claude',
      label: 'Claude Code',
      logo: claudeLogo,
      config:
        'claude mcp add --transport http overleaf \\\n' +
        `  ${url} \\\n` +
        '  --header "Authorization: Bearer <token>"',
    },
    {
      key: 'codex',
      label: 'Codex',
      logo: codexLogo,
      file: '~/.codex/config.toml',
      config:
        '[mcp_servers.overleaf]\n' +
        `url = "${url}"\n` +
        'bearer_token_env_var = "OVERLEAF_TOKEN"',
    },
    {
      key: 'cursor',
      label: 'Cursor',
      logo: cursorLogo,
      file: '~/.cursor/mcp.json',
      config: JSON.stringify(
        {
          mcpServers: {
            overleaf: {
              url,
              headers: { Authorization: 'Bearer ${env:OVERLEAF_TOKEN}' },
            },
          },
        },
        null,
        2
      ),
    },
    {
      key: 'vscode',
      label: 'VS Code',
      logo: vscodeLogo,
      file: '.vscode/mcp.json',
      config: JSON.stringify(
        {
          inputs: [
            {
              type: 'promptString',
              id: 'overleaf-token',
              description: 'Overleaf Git authentication token',
              password: true,
            },
          ],
          servers: {
            overleaf: {
              type: 'http',
              url,
              headers: { Authorization: 'Bearer ${input:overleaf-token}' },
            },
          },
        },
        null,
        2
      ),
    },
    {
      key: 'gemini',
      label: 'Gemini CLI',
      logo: geminiLogo,
      config:
        'gemini mcp add --transport http \\\n' +
        '  --header "Authorization: Bearer <token>" \\\n' +
        `  overleaf ${url}`,
    },
  ]

  return (
    <OLModal
      show={show}
      animation
      onHide={handleHide}
      id="mcp-server-modal"
      size="lg"
    >
      <OLModalHeader closeButton>
        <OLModalTitle>{t('mcp_server')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        <p>{t('mcp_server_connect_with_git_token')}</p>
        <CopyableCode content={url} />

        <TabContainer defaultActiveKey="claude">
          <div className="ol-tabs">
            <div className="nav-tabs-container">
              <Nav as="ul" variant="tabs" className="align-left">
                {clients.map(client => (
                  <NavItem as="li" key={client.key}>
                    <NavLink
                      eventKey={client.key}
                      as="button"
                      className="d-flex align-items-center gap-2"
                    >
                      <img src={client.logo} alt="" width={16} height={16} />
                      {client.label}
                    </NavLink>
                  </NavItem>
                ))}
              </Nav>
            </div>
            <TabContent className="mt-3">
              {clients.map(client => (
                <TabPane key={client.key} eventKey={client.key}>
                  {'file' in client && (
                    <div className="small text-muted">{client.file}</div>
                  )}
                  <CopyableCode content={client.config} className="mt-1" />
                </TabPane>
              ))}
            </TabContent>
          </div>
        </TabContainer>
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={handleHide}>
          {t('close')}
        </OLButton>
        <OLButton variant="primary" href="/user/settings" target="_blank">
          {t('go_to_settings')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}

function McpIntegrationCard() {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const { project } = useProjectContext()

  // The MCP server is only there next to git-bridge
  if (!getMeta('ol-gitBridgeEnabled')) {
    return null
  }

  return (
    <>
      <IntegrationCard
        title={t('mcp_server')}
        description={t('mcp_server_description')}
        icon={<McpLogo size={32} />}
        showPaywallBadge={false}
        onClick={() => setShowModal(true)}
      />
      <McpModal
        show={showModal}
        projectId={project?._id || ''}
        handleHide={() => setShowModal(false)}
      />
    </>
  )
}

export default McpIntegrationCard
