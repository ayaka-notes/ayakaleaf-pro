
import { Trans, useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Button } from 'react-bootstrap'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import OLButton from '@/shared/components/ol/ol-button'
import { useProjectContext } from '@/shared/context/project-context'
import getMeta from '@/utils/meta'

import {
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
    OLModal,
} from '@/shared/components/ol/ol-modal'
import GitFork from '@/shared/svgs/git-fork'



type Props = {
    handleHide: () => void
    projectId: string
}

function ModalGitBridgeSync({ handleHide, projectId }: Props) {
    const { t } = useTranslation()
    const gitCloneMethod = "git clone " + window.location.origin + '/git/' + projectId;

    // git clone https://git@git.overleaf.com/<project_id>
    const gitCloneMethodOption = "git clone " + window.location.protocol + "//git@" + window.location.host + "/git/" + projectId;

    return (
        <>
            <OLModalHeader closeButton>
                <OLModalTitle>{t('clone_with_git')}</OLModalTitle>
            </OLModalHeader>

            <OLModalBody>
                <div className='git-bridge-optional-tokens'>
                    <div className='git-bridge-optional-tokens-header'>
                        {t('git_authentication_token')}
                    </div>
                    <p>
                        {t('git_bridge_modal_git_clone_your_project')}
                    </p>
                    <div className="git-bridge-copy">
                        <code>{gitCloneMethodOption}</code>
                        <span>
                            <CopyToClipboard content={gitCloneMethodOption}
                                kind="text" />
                        </span>
                    </div>

                    <Trans
                        i18nKey="git_bridge_modal_use_previous_token"
                        components={[
                            <a
                                href="/learn/how-to/Git_integration_authentication_tokens"
                                target="_blank"
                                rel="noopener noreferrer"
                            />,
                        ]}
                    >
                    </Trans>
                    {/* git_bridge_modal_use_previous_token */}
                </div>
            </OLModalBody>

            <OLModalFooter>
                <Button
                    onClick={handleHide}
                    variant="secondary"
                    className="btn-secondary btn"
                >
                    {t('close')}
                </Button>
                
                <Button
                    variant="primary"
                    className="btn-primary btn"
                    href="/user/settings"
                    target="_blank"
                >
                    {t('go_to_settings')}
                </Button>
            </OLModalFooter>
        </>
    )
}


type GitBridgeSyncModalProps = {
    show: boolean
    projectId: string
    handleHide: () => void
}

function GitBridgeSyncModal({ show, projectId, handleHide }: GitBridgeSyncModalProps) {
    return (
        <OLModal show={show} animation onHide={handleHide}
            id="git-bridge-sync-modal" backdrop="static" size="lg"
            initialFocus={false} enforceFocus={false}
        >
            <ModalGitBridgeSync projectId={projectId} handleHide={handleHide}
            />
        </OLModal>
    )
}



function GitBridgeSyncButton() {
    const { t } = useTranslation()

    // 对话框
    const [showGitBridgeSyncModal, setShowGitBridgeSyncModal] = useState(false)
    const { project, tags: projectTags } = useProjectContext()
    const gitBridgeEnabled = getMeta('ol-gitBridgeEnabled') || false

    if (!gitBridgeEnabled) {
        return null
    }

    // https://fonts.google.com/icons?hl=zh-cn
    return (
        <>
            <OLButton
                variant="link"
                className="left-menu-button"
                onClick={() => setShowGitBridgeSyncModal(true)}
                leadingIcon={<GitFork />}
            >
                {t('git')}
            </OLButton>
            <GitBridgeSyncModal
                show={showGitBridgeSyncModal}
                handleHide={() => setShowGitBridgeSyncModal(false)}
                projectId={project?._id || ''}
            />
        </>
    )
}

export default GitBridgeSyncButton