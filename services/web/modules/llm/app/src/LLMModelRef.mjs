/*
 * LLMModelRef - the model-ref grammar shared by the client and the controllers.
 *
 *   site lane:  "qwen3.8:latest"        (bare model id)
 *   user lane:  "u:<rowId8hex>:<model>" (BYO provider row + model)
 *
 * Kept as a pure module (no app imports) so the unit tests can load it without
 * pulling the whole Overleaf app tree.
 */

const USER_REF = /^u:([0-9a-f]{8}):(.+)$/

export function parseModelRef(modelString) {
    const match = USER_REF.exec(String(modelString || ''))
    if (match) return { kind: 'user', rowId: match[1], model: match[2] }
    return { kind: 'site', model: String(modelString || '') }
}

export function makeUserModelRef(rowId, model) {
    return `u:${rowId}:${model}`
}

export default { parseModelRef, makeUserModelRef }
