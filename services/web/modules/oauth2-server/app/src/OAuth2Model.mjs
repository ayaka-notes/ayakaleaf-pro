import { OauthApplication } from '../../../../app/src/models/OauthApplication.mjs'
import { OauthAccessToken } from '../../../../app/src/models/OauthAccessToken.mjs'
import { OauthAuthorizationCode } from '../../../../app/src/models/OauthAuthorizationCode.mjs'
import SecretsHelper from './SecretsHelper.mjs'
import logger from '@overleaf/logger'


/**
 * To Scope Array
 * Converts a scope string or array into an array of scopes
 * @param {string|Array} val - Scope string or array
 * @returns {Array} Array of scopes
 */
const toScopeArray = val =>
  Array.isArray(val)
    ? val
    : typeof val === 'string'
      ? val.split(/\s+/).filter(Boolean)
      : []

/**
 * OAuth2 Model implementation for @node-oauth/oauth2-server
 * This implements the required interface for the OAuth2 server
 */
class OAuth2Model {
  /**
   * Get access token from the database
   * @param {string} accessToken - The access token to retrieve
   * @returns {Promise<Object>} Token object with client, user, and scope
   */
  async getAccessToken(accessToken) {
    const hashedToken = SecretsHelper.hashSecret(accessToken)
    const token = await OauthAccessToken.findOne({
      accessToken: hashedToken,
    })
      .populate('user_id')
      .populate('oauthApplication_id')
      .lean()
      .exec()

    if (!token) {
      logger.debug({}, 'Access token not found')
      return null
    }

    // Check if token is expired
    if (token.accessTokenExpiresAt && token.accessTokenExpiresAt < new Date()) {
      return null
    }

    // Reject tokens of suspended or deleted users
    if (!token.user_id || token.user_id.suspended) {
      return null
    }

    // Like verifyToken of /oauth/token/info, which git-bridge calls; MCP
    // requests only come through here
    await OauthAccessToken.updateOne(
      { _id: token._id },
      { $set: { lastUsedAt: new Date() } }
    ).exec()

    return {
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      scope: toScopeArray(token.scope),
      client: token.oauthApplication_id
        ? {
            id: token.oauthApplication_id.id,
            grants: token.oauthApplication_id.grants,
          }
        : null,
      user: token.user_id
        ? {
            _id: token.user_id._id,
            email: token.user_id.email,
            first_name: token.user_id.first_name,
            last_name: token.user_id.last_name,
          }
        : null,
    }
  }

  /**
   * Get refresh token from the database
   * @param {string} refreshToken - The refresh token to retrieve
   * @returns {Promise<Object>} Token object
   */
  async getRefreshToken(refreshToken) {
    const hashedToken = SecretsHelper.hashSecret(refreshToken)
    const token = await OauthAccessToken.findOne({
      refreshToken: hashedToken,
    })
      .populate('user_id')
      .populate('oauthApplication_id')
      .lean()
      .exec()

    if (!token) {
      return null
    }

    // Check if refresh token is expired
    if (
      token.refreshTokenExpiresAt &&
      token.refreshTokenExpiresAt < new Date()
    ) {
      return null
    }

    return {
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
      scope: toScopeArray(token.scope),
      client: token.oauthApplication_id
        ? {
            id: token.oauthApplication_id.id,
            grants: token.oauthApplication_id.grants,
          }
        : null,
      user: token.user_id
        ? {
            _id: token.user_id._id,
            email: token.user_id.email,
            first_name: token.user_id.first_name,
            last_name: token.user_id.last_name,
          }
        : null,
    }
  }

  /**
   * Get authorization code from the database
   * @param {string} authorizationCode - The authorization code
   * @returns {Promise<Object>} Authorization code object
   */
  async getAuthorizationCode(authorizationCode) {
    const code = await OauthAuthorizationCode.findOne({
      authorizationCode,
    })
      .populate('user_id')
      .populate('oauthApplication_id')
      .lean()
      .exec()

    if (!code) {
      return null
    }

    // Check if code is expired
    if (code.expiresAt && code.expiresAt < new Date()) {
      return null
    }

    return {
      code: code.authorizationCode,
      expiresAt: code.expiresAt,
      redirectUri: code.redirectUri,
      scope: code.scope,
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
      client: code.oauthApplication_id
        ? {
            id: code.oauthApplication_id.id,
            grants: code.oauthApplication_id.grants,
          }
        : null,
      user: code.user_id
        ? {
            _id: code.user_id._id,
            email: code.user_id.email,
            first_name: code.user_id.first_name,
            last_name: code.user_id.last_name,
          }
        : null,
    }
  }

  /**
   * Get client from the database
   * @param {string} clientId - The client ID
   * @param {string} clientSecret - The client secret (optional)
   * @returns {Promise<Object>} Client object
   */
  async getClient(clientId, clientSecret) {
    const client = await OauthApplication.findOne({ id: clientId })
      .lean()
      .exec()

    if (!client) {
      return null
    }

    // If client secret is provided, verify it
    if (clientSecret) {
      if (!SecretsHelper.verifySecret(clientSecret, client.clientSecret)) {
        return null
      }
    }

    return {
      id: client.id,
      clientSecret: client.clientSecret,
      redirectUris: client.redirectUris,
      grants: client.grants,
      scopes: client.scopes,
      pkceEnabled: client.pkceEnabled,
    }
  }

  /**
   * Get user from credentials (for password grant)
   * @param {string} username - Username or email
   * @param {string} password - Password
   * @returns {Promise<Object>} User object
   */
  async getUserFromClient(client) {
    // This is used for client_credentials grant
    // Return a service user or null if not supported
    return null
  }

  /**
   * Save token to the database
   * @param {Object} token - Token to save
   * @param {Object} client - Client object
   * @param {Object} user - User object
   * @returns {Promise<Object>} Saved token object
   */
  async saveToken(token, client, user) {
    const tokenData = {
      accessToken: SecretsHelper.hashSecret(token.accessToken),
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      scope: token.scope,
      oauthApplication_id: null,
      user_id: user ? user._id : null,
      createdAt: new Date(),
    }

    if (client && client.id) {
      const clientDoc = await OauthApplication.findOne({ id: client.id })
        .lean()
        .exec()
      if (clientDoc) {
        tokenData.oauthApplication_id = clientDoc._id
      }
    }

    if (token.refreshToken) {
      tokenData.refreshToken = SecretsHelper.hashSecret(token.refreshToken)
      tokenData.refreshTokenExpiresAt = token.refreshTokenExpiresAt
    }

    const savedToken = await OauthAccessToken.create(tokenData)

    return {
      accessToken: savedToken.accessToken,
      accessTokenExpiresAt: savedToken.accessTokenExpiresAt,
      refreshToken: savedToken.refreshToken,
      refreshTokenExpiresAt: savedToken.refreshTokenExpiresAt,
      scope: toScopeArray(savedToken.scope),
      client,
      user,
    }
  }

  /**
   * Save authorization code to the database
   * @param {Object} code - Authorization code data
   * @param {Object} client - Client object
   * @param {Object} user - User object
   * @returns {Promise<Object>} Saved authorization code
   */
  async saveAuthorizationCode(code, client, user) {
    const clientDoc = await OauthApplication.findOne({ id: client.id })
      .lean()
      .exec()

    const codeData = {
      authorizationCode: code.authorizationCode,
      expiresAt: code.expiresAt,
      redirectUri: code.redirectUri,
      scope: code.scope,
      oauthApplication_id: clientDoc ? clientDoc._id : null,
      user_id: user ? user._id : null,
      codeChallenge: code.codeChallenge,
      codeChallengeMethod: code.codeChallengeMethod,
    }

    await OauthAuthorizationCode.create(codeData)

    return {
      authorizationCode: code.authorizationCode,
      expiresAt: code.expiresAt,
      redirectUri: code.redirectUri,
      scope: code.scope,
      client,
      user,
    }
  }

  /**
   * Revoke authorization code (delete it)
   * @param {Object} code - Authorization code object
   * @returns {Promise<boolean>} True if successfully revoked
   */
  async revokeAuthorizationCode(code) {
    const result = await OauthAuthorizationCode.deleteOne({
      authorizationCode: code.code,
    }).exec()
    return result.deletedCount > 0
  }

  /**
   * Revoke token (delete it)
   * @param {Object} token - Token object
   * @returns {Promise<boolean>} True if successfully revoked
   */
  async revokeToken(token) {
    const hashedToken = SecretsHelper.hashSecret(token.refreshToken)
    const result = await OauthAccessToken.deleteOne({
      refreshToken: hashedToken,
    }).exec()
    return result.deletedCount > 0
  }

  /**
   * Verify scope for a token
   * @param {Object} token - Token object
   * @param {Array} scope - Scope to verify
   * @returns {Promise<boolean>} True if token has the required scope
   */
  async verifyScope(token, scope) {
    if (!token.scope) {
        return false
    }

    const tokenScopes = toScopeArray(token.scope)
    // Check if all required scopes are in token scopes
    const requiredScopes = Array.isArray(scope) ? scope : scope.split(' ')

    return requiredScopes.every(s => tokenScopes.includes(s))
  }

  /**
   * Validate scope for authorization request
   * @param {Object} user - User object
   * @param {Object} client - Client object
   * @param {string} scope - Requested scope
   * @returns {Promise<string|false>} Validated scope or false
   */
  async validateScope(user, client, scope) {
    if (!client.scopes || client.scopes.length === 0) {
      return scope
    }

    const requestedScopes = scope ? scope.split(' ') : []
    const validScopes = requestedScopes.filter(s => client.scopes.includes(s))

    return validScopes.length > 0 ? validScopes.join(' ') : false
  }
}

export default new OAuth2Model()