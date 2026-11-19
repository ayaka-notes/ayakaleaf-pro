# token-api

Read and write review comments of a project over HTTP, authenticated with a
git-bridge personal access token. Meant for scripts and coding agents that
already work on the project through the git bridge and need to see the
comments reviewers left in the editor, answer them, resolve them, or leave
their own.

Enabled together with the git bridge (`GIT_BRIDGE_ENABLED=true`); without it
the module does nothing. This file is served as `GET /api/v1` (Markdown, no
token needed), so a client can be pointed at that URL.

## Authentication

Every request carries a git-bridge token:

    Authorization: Bearer olp_...

Tokens are created in Account Settings → Git integration. The same token that
authenticates `git clone` works here; if a git credential helper already
stores it, it can be reused from there.

The token identifies a user. The user must be a member of the project (owner,
editor, reviewer or read-only). Requests for projects the user is not a member
of, and for ids that do not exist, answer `404` so the API does not reveal
which projects exist. Site admins get no special access. Rate limit: 60
requests per minute per client IP (`429`).

### Permissions

The rules follow the editor's review routes:

| Route | Owner, editor (also editor via sharing link) | Reviewer | Read-only (invited) | Read-only via sharing link |
| --- | --- | --- | --- | --- |
| `GET /threads`, `GET /ranges` | yes | yes | yes | `404` |
| `POST /comments` | yes | yes | yes | `404` |
| `POST /thread/:thread_id/messages` | yes | yes | yes | `404` |
| `POST .../resolve`, `.../reopen` | yes | own threads only, else `403` | `403` | `404` |

A read-only member who joined through a sharing link and was never invited
does not see comments in the editor, so the API treats them as a non-member.
A reviewer may resolve or reopen a thread whose first message they wrote.
`403` answers `{ "error": "forbidden" }`.

Comments created or answered through the API appear in the editor under the
token user's name, like comments made in the browser.

## Routes

All routes live under `/api/v1/project/:project_id`. Ids are 24-hex Mongo ids.
Bodies are JSON.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/threads` | All comment threads and tracked changes, with file and line |
| GET | `/threads?format=md` | Same as Markdown, for pasting into a prompt |
| POST | `/comments` | New comment anchored to a text passage |
| POST | `/thread/:thread_id/messages` | Reply to a thread |
| POST | `/doc/:doc_id/thread/:thread_id/resolve` | Resolve a thread |
| POST | `/doc/:doc_id/thread/:thread_id/reopen` | Reopen a thread |
| GET | `/ranges` | Raw `ranges` object per doc (debugging) |

`GET /api/v1` (without a project) returns this document.

### GET /threads

```json
{
  "project": { "id": "…", "name": "My paper" },
  "generated_at": "2026-10-10T14:00:00.000Z",
  "threads": [
    {
      "id": "<thread_id>",
      "doc_id": "<doc_id>",
      "file": "sections/intro.tex",
      "line": 42,
      "quote": "the text the comment is attached to",
      "resolved": false,
      "resolved_at": null,
      "resolved_by": null,
      "messages": [
        {
          "id": "…",
          "author": { "id": "…", "name": "Jane Doe" },
          "time": "2026-10-10T13:58:00.000Z",
          "edited_at": null,
          "content": "Please cite the 2024 survey here."
        }
      ]
    }
  ],
  "changes": [
    {
      "id": "…",
      "file": "sections/intro.tex",
      "line": 7,
      "type": "insert",
      "text": "inserted text",
      "author": { "id": "…", "name": "Jane Doe" },
      "time": "2026-10-10T13:50:00.000Z"
    }
  ]
}
```

Threads are sorted by file and line. A thread whose anchor was deleted from
the document has `doc_id`, `file`, `line` and `quote` set to `null`. `line`
counts from 1 and refers to the current document content.

The Markdown form prints one heading per file and one `### Line N (open|resolved)
[thread <id>]` heading per thread, followed by the messages, then a
"Tracked changes" section.

### POST /comments

Create a thread anchored to a passage. The document is read live; the
passage must exist exactly once, or `offset` must name its position.

Request:

```json
{ "file": "sections/intro.tex", "quote": "the text to comment on", "content": "The comment." }
```

Optional `offset`: UTF-16 code-unit offset of `quote` in the document, for a
passage that occurs more than once, counted in the document text with lines
joined by `\n`.

Response `201`:

```json
{
  "thread_id": "…", "doc_id": "…", "file": "sections/intro.tex", "line": 42,
  "quote": "the text to comment on",
  "message": { "id": "…", "time": "…", "content": "The comment." }
}
```

Errors: `400 bad request` (missing fields, `quote` splits a surrogate pair),
`404` (unknown file), `409 conflict` with `reason` one of `quote not found`,
`quote ambiguous`, `quote not at offset`, `anchor rejected` (document changed
between read and write, or the per-document comment limit is reached). On
`409` nothing was written; read `/threads` again and retry.

### POST /thread/:thread_id/messages

Request `{ "content": "Reply text." }`. Response `201`
`{ "id", "time", "content" }`. `404` for a thread the project does not have.

### POST /doc/:doc_id/thread/:thread_id/resolve, /reopen

No body. Response `204`. `404` unless the thread is anchored in that
document (`doc_id` from `/threads`).

## Example

```sh
TOKEN=olp_...
P=https://overleaf.example.org/api/v1/project/<project_id>

curl -sS -H "Authorization: Bearer $TOKEN" "$P/threads?format=md"

curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"content":"Done, see commit abc123."}' "$P/thread/<thread_id>/messages"

curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  "$P/doc/<doc_id>/thread/<thread_id>/resolve"
```

Avoid putting the token on the command line on shared machines; curl reads
`-H` lines from a config file given with `--config`.

## Project export/import bundles

A project's review state lives outside the project files: comment anchors
and tracked changes are stored as ranges on the documents, and comment
messages in the chat service. Exporting a project's files alone loses them.

`ProjectZipStreamManager` therefore adds an `overleaf-comments-and-changes.json`
to every project zip — the editor's download button as well as
`services/web/modules/server-ce-scripts/scripts/export-user-projects.mjs`
(single project, per user, or `--export-all`), containing the per-document
ranges (`comments`, `changes`) and the anchored comment threads (messages,
resolution state). The format:

```json
{
  "format": "overleaf-comments-and-changes",
  "version": 1,
  "project_id": "...",
  "exported_at": "...",
  "docs": [{ "id": "...", "ranges": { "comments": [], "changes": [] } }],
  "threads": { "<threadId>": { "resolved": false, "messages": [] } }
}
```

`scripts/import-project-review.mjs` reconstitutes the state in an existing
project from that file (or directly from the export zip): comment threads
are recreated under their original ids, anchors and tracked changes are
written to the docstore the same way a project duplication clones ranges.
It validates every anchor against the target document text, skips (and
reports) anything that no longer matches or that the target already has,
and `--force` overrides the skips. Run it when the target project is not
being actively edited.

## Implementation notes

- `TokenApiAuthMiddleware.mjs` validates the token through the oauth2-server
  personal access token store (git-bridge tokens: hashed lookup plus
  type/scope check, suspended-user rejection), checks membership with
  `AuthorizationManager.getPrivilegeLevelForProject` (no admin shortcut, no
  public access), rejects restricted users (`AuthorizationManager.isRestrictedUser`)
  and logs one line per authenticated request. Resolve and reopen add
  `tokenThreadResolveAccess`, which applies the rule of core's
  `AuthorizationManager.canUserDeleteOrResolveThread` to the admin-free
  privilege level.
- `GET /threads` flushes the project to Mongo, then combines docstore ranges
  (anchors), chat threads (messages) and doc paths. `op.p` of a comment is a
  UTF-16 offset into `lines.join('\n')`.
- Writes go through the same handlers the editor uses (`ChatApiHandler`,
  `DocumentUpdaterHandler`) and emit the same real-time events, so open
  editors update without reload.
- `POST /comments` uses a document-updater route,
  `POST /project/:project_id/doc/:doc_id/comment`, which applies the comment
  op under the document lock after checking version, text at offset and the
  comment limit, so a rejected anchor never reaches connected editors.
- Routes are on `publicApiRouter`: no session, no CSRF.
