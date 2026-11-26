// overleaf-lab: "AI Error Assist" — per-compile-error suggested fixes
// (upstream-style: explanation + suggested code, BYO-model-aware).
//
// Pure helpers live here so they are unit-testable without the web stack:
// the response schema, the prompt/message builder for the model call, and
// the post-call validation (chatObject already enforces the schema at
// generation time; this validates cross-field invariants such as span order).

import { z } from 'zod'

// Response contract for POST /project/:id/llm/compile-fix.
//
// suggestedOld: the EXACT current text to change (a contiguous snippet of
//                one line, or a multi-line block; empty string = pure insert).
// suggestedNew: the replacement text; empty string = pure DELETION of suggestedOld.
// span:         optional [firstLine, lastLine] (1-based) for multi-line fixes.
// explanation:  optional (the card falls back to a generic sentence).
// At least one of suggestedOld/suggestedNew must be non-empty — enforced in
// validateCompileFixObject (cross-field check).
export const compileFixSchema = z.object({
    explanation: z
        .string()
        .max(6000)
        .optional()
        .describe('Optional 1-3 short sentences explaining the cause and the fix, in the language of the log message.'),
    suggestedOld: z
        .string()
        .max(8000)
        .describe('The exact text currently in the document that the fix applies to (an exact copy, may be empty for a pure insertion).'),
    suggestedNew: z
        .string()
        .max(8000)
        .describe('The replacement text for suggestedOld. Use an EMPTY string for a pure deletion.'),
    span: z
        .tuple([z.number().int().positive(), z.number().int().positive()])
        .optional()
        .describe('Optional [firstLine, lastLine] 1-based line numbers when the fix spans multiple lines.')
})

const MAX_EXPLANATION = 6000
const MAX_SUGGESTED = 8000

// Cross-field validation for chatObject results (span ordering and the
// "at least a change" rule cannot be expressed in the schema itself).
export function validateCompileFixObject(obj) {
    if (!obj || typeof obj !== 'object') {
        throw Object.assign(new Error('compile-fix result must be an object'), { code: 'llm-bad-fix' })
    }
    const explanation = String(obj.explanation || '').trim().slice(0, MAX_EXPLANATION)
    const suggestedOld = String(obj.suggestedOld ?? '')
    const suggestedNew = String(obj.suggestedNew ?? '').trim()
    if (suggestedOld.length > MAX_SUGGESTED || suggestedNew.length > MAX_SUGGESTED) {
        throw Object.assign(new Error('compile-fix: oversized suggestion'), { code: 'llm-bad-fix' })
    }
    if (!suggestedOld && !suggestedNew) {
        throw Object.assign(new Error('compile-fix: no change provided (both suggestedOld and suggestedNew are empty)'), { code: 'llm-bad-fix' })
    }
    let span = null
    if (Array.isArray(obj.span)) {
        const a = Number.parseInt(obj.span[0], 10)
        const b = Number.parseInt(obj.span[1], 10)
        if (Number.isFinite(a) && Number.isFinite(b) && a >= 1 && b >= a) {
            span = [a, b]
        }
    }
    return { explanation, suggestedOld, suggestedNew, span }
}

// Messages for the model call. `snippet` is the numbered source window
// (">" marks the failing line) produced by the controller.
export function buildCompileFixMessages({
    level = 'error',
    file = '',
    line = 1,
    message = '',
    snippet = '',
    hint = '',
    adminPrompt = ''
}) {
    const contract = [
        'You are an expert LaTeX assistant fixing a compile error/warning in an Overleaf project.',
        'You receive: the log entry, its file and line, and a numbered window of the actual source lines (" > " marks the failing line).',
        'Return the object described by the schema. Rules:',
        '- Keep the fix MINIMAL: change only what is needed to resolve the entry; never rewrite untouched code, do not add comments or explanations to suggestedNew.',
        '- suggestedOld MUST be an exact copy of the current text (same whitespace, same case). For single-line fixes use a contiguous part of that line (often the whole line); for multi-line fixes join the lines with newlines exactly as they appear and also set span = [firstLine, lastLine].',
        '- suggestedNew is what replaces suggestedOld. If the fix is to REMOVE text, set suggestedNew to an empty string (a pure deletion). Do not use markdown code fences anywhere.',
        '- If an alternative fix genuinely does not exist, a minimal valid change (e.g. pure deletion of the offending characters) is better than no change.',
        '- The answer is a JSON object: inside string values every backslash MUST be escaped (write one backslash as \\\\). Newlines inside strings must be \\u000a or \\n.',
        '- Reply in the same language as the log message.'
    ].join('\n')

    const userParts = []
    if (adminPrompt) {
        userParts.push(`Deployment instruction from the site administrator (apply its spirit):\n${adminPrompt}`)
    }
    if (hint) {
        userParts.push(
            'The user asked for a DIFFERENT suggestion. A previous (unsatisfactory) suggestion was:\n' +
            `  old: ${hint.old}\n  new: ${hint.new}\n` +
            'Do NOT repeat it. Suggest an alternative fix.'
        )
    }
    userParts.push(
        `Log entry (${level}) at ${file}, line ${line}:\n${message || '(no message text)'}`
    )
    userParts.push(`Numbered source lines (the line marked " > " is line ${line}):\n${snippet}`)
    userParts.push('Return only the JSON object — no prose outside the object.')

    return [
        { role: 'system', content: contract },
        { role: 'user', content: userParts.join('\n\n') }
    ]
}

export default {
    compileFixSchema,
    validateCompileFixObject,
    buildCompileFixMessages
}
