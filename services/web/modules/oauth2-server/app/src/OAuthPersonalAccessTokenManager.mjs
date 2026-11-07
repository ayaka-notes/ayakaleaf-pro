import { db } from '../../../../app/src/infrastructure/mongodb.mjs'
import SecretsHelper from './SecretsHelper.mjs'
import { ObjectId } from 'mongodb';
import { OauthAccessToken } from '../../../../app/src/models/OauthAccessToken.mjs';
import { OauthApplication } from '../../../../app/src/models/OauthApplication.mjs';
import logger from '@overleaf/logger';

// OAuthPersonalAccessToken Length
// Excluding the prefix olp_, currently the length is consistent with overlord at 36
const PAT_LENGTH = 36

const PersonalAccessTokenManager = {
    async listTokens(userId) {
        // Sort by creation time in descending order
        let query = {
            user_id: userId,
            type: 'personal_access_token'
        }

        // Find all tokens in db.oauthAccessTokens
        let tokens = await db.oauthAccessTokens.find(query).sort
            ({ createdAt: -1 }).toArray()


        // Only return partial data
        let retTokens = []
        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i]
            let retToken = {
                _id: token._id,
                accessTokenPartial: token.accessTokenPartial,
                createdAt: token.createdAt,
                accessTokenExpiresAt: token.accessTokenExpiresAt,
                lastUsedAt: token.lastUsedAt
            }
            retTokens.push(retToken)
        }
        return retTokens
    },

    async getUserTokenNums(userId) {
        let query = {
            user_id: userId,
            type: 'personal_access_token'
        }

        // Find all tokens in db.oauthAccessTokens
        let tokens = await db.oauthAccessTokens.find(query).toArray()
        return tokens.length
    },

    // Return token in the format olp_ + 32 random alphanumeric characters
    async createToken(userId) {
        let accessToken = "olp_" + SecretsHelper.createSecret(PAT_LENGTH)
        let gitBridgeApp = await OauthApplication.findOne({ name: 'Overleaf Git Bridge' }).lean().exec()
        const appId = gitBridgeApp ? gitBridgeApp._id : null
        
        if (!appId) {
            logger.error({ userId }, 'Git Bridge OAuth application not found when creating PAT')
            return null
        }

        // Generate a new access token
        let createdAt = new Date()
        let accessTokenExpiresAt = new Date(createdAt)

        // access token validity is 1 year
        accessTokenExpiresAt.setFullYear(accessTokenExpiresAt.getFullYear() + 1)

        // Save to database
        let accessTokenDoc = {
            accessToken: SecretsHelper.hashSecret(accessToken),
            accessTokenPartial: accessToken.substring(0, 8),
            oauthApplication_id: appId,
            type: 'personal_access_token',
            scope: 'git_bridge',
            accessTokenExpiresAt: accessTokenExpiresAt,
            user_id: userId,
            createdAt: createdAt
        }

        // Save to database
        await db.oauthAccessTokens.insertOne(
            accessTokenDoc
        )
        // Currently we use OAuth2Server's ClientID Empty to save personal access tokens
        return accessToken
    },

    // Delete a personal access token owned by a specific user
    async removeToken(tokenId, userId) {
        if (!ObjectId.isValid(tokenId)) {
            return { deletedCount: 0 }
        }
        const query = {
            _id: new ObjectId(tokenId),
            user_id: userId,
            type: 'personal_access_token',
        }

        // Delete token from database
        const result = await db.oauthAccessTokens.deleteOne(query)
        
        return result
    },

    // Verify a personal access token
    async verifyToken(accessToken) {
        let query = {
            accessToken: SecretsHelper.hashSecret(accessToken)
        }

        let token = await db.oauthAccessTokens.findOne(query)
        if (!token) {
            logger.debug({}, 'Personal access token not found')
            return null
        }

        // New access token instance
        let tokenInstance = new OauthAccessToken(token)
        
        // Check if the token is expired
        let now = new Date()
        if (tokenInstance.accessTokenExpiresAt < now) {
            logger.debug({}, 'Personal access token is expired')
            return null
        }

        // Reject tokens of suspended or deleted users
        let user = await db.users.findOne({ _id: tokenInstance.user_id }, { projection: { suspended: 1 } })
        if (!user || user.suspended) {
            logger.debug({}, 'Personal access token user is suspended or deleted')
            return null
        }

        // Update lastUsedAt
        tokenInstance.lastUsedAt = now
        
        // Update database
        await db.oauthAccessTokens.updateOne({ _id: tokenInstance._id }, { $set: { lastUsedAt: now } })
        
        tokenInstance.accessToken = accessToken
        return tokenInstance
    }
}

export default PersonalAccessTokenManager