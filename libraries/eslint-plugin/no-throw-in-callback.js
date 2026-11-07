const CALLBACK_PARAM_NAMES = new Set(['cb', 'callback', 'done', 'next'])

function isCallbackParam(param) {
  return (
    param && param.type === 'Identifier' && CALLBACK_PARAM_NAMES.has(param.name)
  )
}

module.exports = {
  meta: {
    type: 'error',
    docs: {
      description: 'Disallow throw statements inside callback-based functions',
    },
    messages: {
      noThrowInCallback:
        'Pass the error to the callback instead of throwing in callback-based code.',
    },
  },
  create(context) {
    // Stack tracks whether each enclosing function is a callback-style function.
    // A callback-style function is non-async and has a last param named cb/callback/done/next.
    const stack = []

    function enterFunction(node) {
      const params = node.params
      const isCallback =
        !node.async &&
        params.length > 0 &&
        isCallbackParam(params[params.length - 1])
      stack.push(isCallback)
    }

    function exitFunction() {
      stack.pop()
    }

    return {
      FunctionDeclaration: enterFunction,
      'FunctionDeclaration:exit': exitFunction,
      FunctionExpression: enterFunction,
      'FunctionExpression:exit': exitFunction,
      ArrowFunctionExpression: enterFunction,
      'ArrowFunctionExpression:exit': exitFunction,
      ThrowStatement(node) {
        if (stack[stack.length - 1]) {
          context.report({ node, messageId: 'noThrowInCallback' })
        }
      },
    }
  },
}
