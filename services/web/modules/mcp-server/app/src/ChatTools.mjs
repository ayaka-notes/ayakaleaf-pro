import { z } from '../../../../app/src/infrastructure/Validation.mjs'
import Features from '../../../../app/src/infrastructure/Features.mjs'
import Modules from '../../../../app/src/infrastructure/Modules.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import ChatManager from '../../../../app/src/Features/Chat/ChatManager.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import { checkNotRestricted, person, rateLimiters, text } from './McpUtils.mjs'

// The project chat, as its panel reads and sends it (ChatController)

// as the chat panel loads it
const PAGE_SIZE = 50

export function buildChatTools({ userId, projectId }) {
  // the editor has no chat routes without the feature
  if (!Features.hasFeature('chat')) return {}

  const checkCanChat = () =>
    checkNotRestricted(
      userId,
      projectId,
      'You cannot use the chat of this project'
    )

  return {
    list_chat_messages: {
      rateLimiter: rateLimiters.listChatMessages,
      description:
        'Read the project chat, newest first, 50 messages at a time; pass ' +
        'before from the previous answer for older ones.',
      inputSchema: {
        before: z
          .number()
          .int()
          .optional()
          .describe('before returned by the previous call, for older messages.'),
      },
      handler: async ({ before }) => {
        await checkCanChat()
        const messages = await ChatApiHandler.promises.getGlobalMessages(
          projectId,
          PAGE_SIZE,
          before
        )
        await ChatManager.promises.injectUserInfoIntoThreads({
          global: { messages },
        })
        return text({
          messages: messages.map(message => ({
            author: person(message.user),
            content: message.content,
            timestamp: new Date(message.timestamp).toISOString(),
          })),
          before:
            messages.length === PAGE_SIZE ? messages.at(-1).timestamp : null,
        })
      },
    },

    send_chat_message: {
      rateLimiter: rateLimiters.sendChatMessage,
      description:
        'Send a message to the project chat; it shows live in Overleaf, ' +
        "under the user's name.",
      inputSchema: {
        content: z.string().min(1).describe('The message.'),
      },
      handler: async ({ content }) => {
        await checkCanChat()
        const message = await ChatApiHandler.promises.sendGlobalMessage(
          projectId,
          userId,
          content
        )
        const user = await UserInfoManager.promises.getPersonalInfo(
          message.user_id
        )
        message.user = UserInfoController.formatPersonalInfo(user)
        EditorRealTimeController.emitToRoom(
          projectId,
          'new-chat-message',
          message
        )
        await Modules.promises.hooks.fire('chatMessageSent', {
          projectId,
          userId,
          messageId: message.id,
        })
        return text('Sent.')
      },
    },
  }
}
