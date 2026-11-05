import { z, zz } from '../../../../app/src/infrastructure/Validation.mjs'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import { checkAccess, person, rateLimiters, text } from './McpUtils.mjs'
// The project chat (the chat bubble in the editor). Same data as the browser:
// /project/:id/messages via ChatApiHandler (the chat service). The browser
// gates these routes with blockRestrictedUserFromProject +
// ensureUserCanReadProject (+ author checks for edit/delete), so the tools
// use exactly those permission checks.
const messageId = zz.objectId().describe('The messageId from list_chat.')
export function buildChatTools({ userId, projectId }) {
  const blockLinkViewers = () =>
    checkAccess(
      (userId, projectId) =>
        !AuthorizationManager.promises.isRestrictedUserForProject(
          userId,
          projectId
        ),
      userId,
      projectId,
      'You can\'t see the chat of this project (you joined by link)'
    )
  const canRead = () =>
    checkAccess(
      (userId, projectId) =>
        AuthorizationManager.promises.canUserReadProject(userId, projectId),
      userId,
      projectId,
      'You can\'t read this project'
    )
  const ownMessage = async id => {
    const message = await ChatApiHandler.promises.getGlobalMessage(
      projectId,
      String(id)
    )
    if (String(message?.user_id) !== String(userId)) {
      throw new Error('Only the author can edit or delete this message')
    }
  }
  return {
    list_chat: {
      rateLimiter: rateLimiters.listChat,
      description:
        'Read the project chat (the chat bubble in Overleaf), newest last: ' +
        'each message with its author, text and time.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(30)
          .describe('At most this many messages (oldest dropped first).'),
      },
      handler: async ({ limit }) => {
        await blockLinkViewers()
        await canRead()
        const messages = await ChatApiHandler.promises.getGlobalMessages(
          projectId,
          limit,
          null
        )
        return text(
          messages.map(message => ({
            messageId: String(message._id),
            author: person(message.user) || message.user_id,
            content: message.content,
            timestamp: new Date(message.timestamp).toISOString(),
            ...(message.edited != null && { edited: true }),
          }))
        )
      },
    },
    send_chat_message: {
      rateLimiter: rateLimiters.sendChatMessage,
      description:
        'Send a message to the project chat (the chat bubble in Overleaf), ' +
        "under the user's name; it shows live for the collaborators.",
      inputSchema: {
        content: z.string().min(1).describe('The message.'),
      },
      handler: async ({ content }) => {
        await blockLinkViewers()
        await canRead()
        const message = await ChatApiHandler.promises.sendGlobalMessage(
          projectId,
          userId,
          content
        )
        return text(
          `Sent (message ${String(message._id)}). The chat shows it live in Overleaf.`
        )
      },
    },
    edit_chat_message: {
      rateLimiter: rateLimiters.editChatMessage,
      description:
        'Edit one project-chat message; only its author (the user) can ' +
        'edit it, like in Overleaf.',
      inputSchema: {
        messageId,
        content: z.string().min(1).describe('The new message.'),
      },
      handler: async ({ messageId, content }) => {
        await blockLinkViewers()
        await canRead()
        await ownMessage(messageId)
        await ChatApiHandler.promises.editGlobalMessage(
          projectId,
          String(messageId),
          userId,
          content
        )
        return text('Message edited.')
      },
    },
    delete_chat_message: {
      rateLimiter: rateLimiters.deleteChatMessage,
      description:
        'Delete one project-chat message; only its author (the user) can ' +
        'delete it, like in Overleaf.',
      inputSchema: { messageId },
      handler: async ({ messageId }) => {
        await blockLinkViewers()
        await canRead()
        await ownMessage(messageId)
        await ChatApiHandler.promises.deleteGlobalMessage(
          projectId,
          String(messageId)
        )
        return text('Message deleted.')
      },
    },
  }
}
