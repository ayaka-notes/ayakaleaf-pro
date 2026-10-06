import GitLogoOrange from "@/shared/svgs/git-logo-orange";
import { Trans, useTranslation } from 'react-i18next'
import EmailCell from "@/features/settings/components/emails/cell";
import Button from '@/shared/components/ol/ol-button'

import moment from 'moment';

import { getJSON, postJSON } from "@/infrastructure/fetch-json";
import { useEffect, useState } from 'react'

import DeleteAuthenticationTokenModal from "./delete-authentication-token-modal";
import CreateAuthenticationTokenModal from "./create-authentication-token-modal";

// 导入 Bootstrap 5 的 Row 和 Col 组件
import { Row, Col } from 'react-bootstrap'

// Header: 表格的头部标题
function LinkingGitBridgeTableHeader() {
    const { t } = useTranslation()
    return (
        <>
            <Row className="small">
                <Col md={4} className="d-none d-sm-block">
                    <EmailCell>
                        <strong>{t('token')}</strong>
                    </EmailCell>
                </Col>
                <Col md={2} className="d-none d-sm-block">
                    <EmailCell>
                        <strong>{t('created_at')}</strong>
                    </EmailCell>
                </Col>
                <Col md={2} className="d-none d-sm-block">
                    <EmailCell>
                        <strong>{t('last_used')}</strong>
                    </EmailCell>
                </Col>
                <Col md={3} className="d-none d-sm-block">
                    <EmailCell>
                        <strong>{t('expires')}</strong>
                    </EmailCell>
                </Col>
            </Row>
            <div className="horizontal-divider"></div>
            <div className="horizontal-divider"></div>
        </>
    )
}

// linking-git-bridge-table
function LinkingGitBridgeTable() {
    const { t } = useTranslation()
    const [OAuthPersonalAccessTokens, setOAuthPersonalAccessTokens] = useState([])
    const [showDeleteTokenModal, setShowDeleteTokenModal] = useState(false)
    const [showCreateTokenModal, setShowCreateTokenModal] = useState(false)
    const [curDeleteTokenId, setCurDeleteTokenId] = useState('')
    const [curCreateAccessToken, setCurCreateAccessToken] = useState('')

    useEffect(() => {
        getJSON('/oauth/personal-access-tokens').then((data) => {
            setOAuthPersonalAccessTokens(data)
        })
    }, [])

    const createNewAuthenticationToken = () => {
        postJSON('/oauth/personal-access-tokens').then((data) => {
            setCurCreateAccessToken(data.accessToken)
            setShowCreateTokenModal(true)
        })
    }

    const updateOAuthPersonalAccessTokens = () => {
        getJSON('/oauth/personal-access-tokens').then((data) => {
            setOAuthPersonalAccessTokens(data)
        })
    }

    return (
        <>
            {
                OAuthPersonalAccessTokens.length > 0 &&
                <LinkingGitBridgeTableHeader />
            }
            {
                OAuthPersonalAccessTokens.map((token) => {
                    return (
                        <Row key={token._id} className="small">
                            <Col md={4} className="d-none d-sm-block">
                                <EmailCell>{token.accessTokenPartial + "************"}</EmailCell>
                            </Col>
                            <Col md={2} className="d-none d-sm-block">
                                <EmailCell>
                                    {moment(token.created_at).format('Do MMM YYYY')}
                                </EmailCell>
                            </Col>
                            <Col md={2} className="d-none d-sm-block">
                                <EmailCell>
                                    {token.lastUsedAt == null ? "N/A" : moment(token.lastUsedAt).format('Do MMM YYYY')}
                                </EmailCell>
                            </Col>
                            <Col md={3} className="d-none d-sm-block">
                                <EmailCell>{moment(token.accessTokenExpiresAt).format('Do MMM YYYY')}</EmailCell>
                            </Col>
                            <Col md={1} className="d-none d-sm-block">
                                <EmailCell>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="linking-git-bridge-revoke-button"
                                        onClick={() => {
                                            setShowDeleteTokenModal(true)
                                            setCurDeleteTokenId(token._id)
                                        }}
                                    >
                                        <i className="material-symbols material-symbols-rounded" aria-hidden="true">delete</i>
                                    </Button>
                                </EmailCell>
                            </Col>
                        </Row>
                    )
                })
            }

            <Row className="small" highlighted>
                <Col xs={12} md={12} lg={12} className="d-sm-block">
                    <EmailCell>
                        {
                            OAuthPersonalAccessTokens.length > 0 &&
                            OAuthPersonalAccessTokens.length < 10 &&
                            <Button
                                variant="link"
                                onClick={() => {
                                    createNewAuthenticationToken()
                                }}
                            >
                                {t('add_another_token')}
                            </Button>
                        }
                        {
                            OAuthPersonalAccessTokens.length == 0 &&
                            <Button 
                                variant="secondary"
                                onClick={() => {
                                    createNewAuthenticationToken()
                                }}
                            >
                                {t('generate_token')}
                            </Button>
                        }
                        {
                            OAuthPersonalAccessTokens.length >= 10 &&
                            <span>{t('token_limit_reached')}</span>
                        }
                    </EmailCell>
                </Col>
            </Row>

            <CreateAuthenticationTokenModal
                show={showCreateTokenModal}
                handleHide={() => {
                    setShowCreateTokenModal(false)
                    updateOAuthPersonalAccessTokens()
                }}
                accessToken={curCreateAccessToken}
            />

            <DeleteAuthenticationTokenModal
                show={showDeleteTokenModal}
                handleHide={() => {
                    setShowDeleteTokenModal(false)
                    updateOAuthPersonalAccessTokens()
                }}
                tokenId={curDeleteTokenId}
            />
        </>
    )
}

// Git集成的设置
function GitIntegrationSetting() {
    const { t } = useTranslation()
    return (
        <div className="settings-widget-container">
            <div className="linking-icon-fixed-position">
                <GitLogoOrange/>
            </div>

            <div className="description-container small">
                <div className="title-row">
                    <h4>{t('git_integration')}</h4>
                </div>
                <p className="small">
                    <Trans
                        i18nKey="git_integration_info"
                        components={[
                            <a
                                key="git-integration-link"
                                href="/learn/how-to/Using_Git_and_GitHub"
                                target="_blank"
                                rel="noopener noreferrer"
                            ></a>
                        ]}
                    />
                </p>
                <h4 className="ui-heading">{t('your_git_access_tokens')}</h4>
                <p className="small">{t('your_git_access_info')}</p>
                <ul className="small">
                    <li>{t('your_git_access_info_bullet_1')}</li>
                    <li>{t('your_git_access_info_bullet_2')}</li>
                    <li>
                        <Trans
                            i18nKey="your_git_access_info_bullet_3"
                            components={[<strong key="strong"></strong>]}
                        />
                    </li>
                    <li>{t('your_git_access_info_bullet_4')}</li>
                    <li>{t('your_git_access_info_bullet_5')}</li>
                </ul>

                <LinkingGitBridgeTable />
            </div>
        </div>
    )
}

export default GitIntegrationSetting;