// Extension point wrapper for sourceEditorExtensions
// Provides the CodeMirror inline completion extension.
// Must be exported as a function (options) => Extension to match the consumer contract.
import { inlineCompletionExtension } from '../components/llm-completion'

export const extension = (_options: Record<string, any>) => inlineCompletionExtension()
