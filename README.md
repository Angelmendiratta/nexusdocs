# NexusDocs — Team Knowledge Base (built on Solarch)

A full-stack team knowledge-base app: workspaces contain documents, documents have comments,
authors, and file attachments, and every action is tracked in an activity log. Built to satisfy
a backend skills assessment requiring use of the `solarch` npm package.

**Live app:** https://nexusdocs-frontend.vercel.app
**Live API:** https://nexusdocs.onrender.com/api/
**Frontend repo:** nexusdocs-frontend

> **Note on live-demo reliability:** the backend runs on Render's free tier, which has no
> persistent disk — every redeploy wipes the database (see "Known Issues" below). If the live
> app appears empty or login fails when you check it, the schema/data may need to be rebuilt.
> Run `node rebuild-schema.js https://nexusdocs.onrender.com <admin-email> <admin-password>`
> (password is printed in Render's deploy logs) and sign up a fresh test user.

## Stack

- **Backend**: Solarch (v0.15.6) — auto-generated REST API, SQLite storage, built-in auth,
  declarative schema/rules — hosted on Render
- **Frontend**: plain HTML/CSS/JS, no framework, no build step — hosted on Vercel
- **Node.js 20 LTS** (required — see Known Issues)

## Features

1. **Auth** — signup/login via Solarch's built-in `auth` collection, JWT sessions
2. **Relational CRUD** — `workspaces → documents → comments`, linked via relation fields
3. **Role-based permissions** — API Rules enforce workspace-owner-only delete, author-only
   edit/delete on documents and comments, while any authenticated user can read/create
4. **File attachments** — upload a file when creating a document, download it from the detail view
5. **Document editing** — in-place edit mode for title/content
6. **Document deletion** — with confirmation prompt
7. **Semantic search readiness** — `documents` has a 1536-dim vector field wired to Solarch's
   cosine-similarity search endpoint (schema-ready; no embeddings generated yet — see "What I'd
   do next")
8. **Activity logging** — every create action is recorded to `activity_log`, implemented at the
   application layer (see Known Issues — Solarch's own hook system doesn't fire on record create)
9. **Realtime** — WebSocket live updates verified working (see Known Issues for the correct
   channel-naming convention, which differs from the package's README example)
10. **Author display** — documents/comments show the author's name (via `expand=author`)
    instead of a raw user ID
11. **Friendly error messages** — backend validation errors (e.g. "Value must be unique") are
    translated into plain language in the UI, with actionable next steps (e.g. a "Sign in
    instead" link when signup hits a duplicate email)

## Schema

| Collection | Type | Key fields |
|---|---|---|
| `users` | auth | `email`, `password`, `name` |
| `workspaces` | base | `wname`, `owner` (→users), `members` (→users, many) |
| `documents` | base | `title`, `content`, `workspace` (→workspaces), `author` (→users), `attachment` (file), `embedding` (vector) |
| `comments` | base | `text`, `document` (→documents), `author` (→users) |
| `activity_log` | base | `action`, `details`, `user` (→users), `workspace` (→workspaces) |

## API Rules

- `workspaces`: list/view/create require auth; update/delete require `@request.auth.id = owner`
- `documents`: list/view/create/update require auth; delete requires `@request.auth.id = author`
- `comments`: list/view/create require auth; update/delete require `@request.auth.id = author`
- `activity_log`: list/view/create require auth

## Local setup

```bash
git clone <this-repo>
cd nexusdocs
npm install
```

Requires **Node 20 LTS** (see Known Issues — Node 24 fails to build a native dependency on
Windows). Set a JWT secret (32+ chars) before starting:

```powershell
# PowerShell
$env:SOLARCH_JWT_SECRET="<generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\">"
npx solarch serve --dev --port 8090
```

```bash
# bash/zsh
export SOLARCH_JWT_SECRET="<your-generated-secret>"
npx solarch serve --dev --port 8090
```

The Admin UI's install screen is broken in this package version (see Known Issues), so create
the first superuser via CLI instead:

```bash
npx solarch superuser-create admin@example.com YourPassword123
```

Then create the schema — either by hand (commands in `setup-commands.md`) or in one shot:

```bash
node rebuild-schema.js http://localhost:8090 admin@example.com YourPassword123
```

## Deployment

**Backend (Render)**
- Start command: `solarch serve --port $PORT`
- Env vars: `SOLARCH_JWT_SECRET`, `CORS_ALLOWED_ORIGINS` (comma-separated list of allowed
  frontend origins)
- Superuser creation on a host with no shell access: temporarily set the start command to
  `node setup-admin.js && solarch serve --port $PORT`, redeploy, copy the generated password
  from the deploy logs, then revert the start command.
- **`rebuild-schema.js`** — run locally, points at any live Solarch URL, and recreates the
  entire schema (5 collections + all API rules) in one command. Built specifically to make
  recovering from Render's free-tier data wipes fast (see Known Issues).

**Frontend (Vercel)**
- Static site, no build step. Deploy the `nexusdocs-frontend` repo directly.
- Edit `config.js` to point at the live backend URL before deploying.
- Add the resulting Vercel URL to the backend's `CORS_ALLOWED_ORIGINS` env var.

## Known Issues

Investigated and documented rather than worked around blindly — several required reading
Solarch's compiled source in `node_modules/solarch/dist/` to confirm root cause.

### 1. `pb_hooks` record-create hooks never fire (confirmed bug)

`dist/tools/jsvm/jsvm.js` registers `onRecordCreate(tag, handler)` in the hook sandbox, but
the `tag` argument (meant to filter by collection) is silently discarded, and — more
importantly — nothing in `dist/apis/record_crud.js`'s create handler ever calls `.trigger()`
on the hook. Verified with a minimal hook that logs on file load (fires every server start) and
on record create (never fires, confirmed across many test records).

**Workaround**: activity logging happens at the application layer — the frontend makes a
second API call to `activity_log` immediately after creating a document or comment.

**Fix**: one line — add the missing `.trigger()` call in `record_crud.js`'s POST handler. Not
pursued given project scope, but straightforward to contribute upstream.

### 2. Realtime works, but the README's channel-naming example is wrong

Initially looked like a second broken feature — an authenticated, subscribed WebSocket client
never received events. Reading `dist/apis/record_crud.js` showed `broadcastRecordEvent()` **is**
called correctly on every create/update/delete. The actual issue: the channel is built as
`collections.${collectionId}.records` using the collection's **ID**, while the package's README
example subscribes using the collection **name** (e.g. `collections.posts.records`). Subscribing
with the correct ID-based channel works and was verified live end-to-end.

### 3. Solarch is hardcoded to SQLite — no driver/adapter for MongoDB or Postgres

Investigated per a suggestion to consider MongoDB or a hosted Postgres (e.g. Neon) for more
durable storage. Reading `dist/core/db.js` and `dist/tools/database/sqlite-driver.js` confirmed
there's no database abstraction layer — every query throughout `dist/core/` and `dist/apis/` is
written directly in SQLite syntax. Swapping databases isn't a config change; it would require
rewriting the package's data layer entirely. Documented as a hard constraint of the tool as
published, not something addressable within this project's scope.

### 4. Render's free tier has no persistent storage

Every redeploy (a code push, an env var change, a settings change) gives the container a fresh
filesystem, wiping `pb_data/` (and with it, the superuser and all collections). This is a
platform limitation, not a code bug. Confirmed by observing the schema disappear after several
otherwise-unrelated deploys (a CORS update, a start-command revert).

**Workaround**: `rebuild-schema.js` (in this repo) rebuilds the full schema against any live
Solarch URL in one command, so recovery after a wipe takes seconds rather than manual re-setup.
User-generated data (test accounts, documents, comments) is *not* recoverable this way — only
the schema/structure. **Proper fix** would be a Render persistent disk (paid tier) or a host
with a free persistent volume (e.g. Fly.io) — not adopted here to avoid another platform
migration this late in the project, but noted as the correct production fix.

### 5. Windows-specific setup friction (resolved, documented for reference)

- **Node 24 fails to compile** `better-sqlite3` (a native dependency) on Windows — no prebuilt
  binary exists for that Node/platform combo, and compiling from source requires Visual Studio
  Build Tools. Fixed by using Node 20 LTS instead (has a prebuilt binary).
- **Global npm installs of `solarch` repeatedly landed incomplete** (missing `dist/`,
  `package.json`) due to leftover EPERM-locked files from an earlier failed install attempt.
  Fixed by installing locally inside a project folder (with its own `package.json`) instead of
  globally.
- **PowerShell's `curl` is aliased to `Invoke-WebRequest`**, which mangles JSON request bodies.
  Used `Invoke-RestMethod` throughout instead.

### 6. Multipart form field names must match the collection schema exactly

The frontend's file-upload code initially sent the file under the field name `file`, but the
collection's actual field is named `attachment`. This mismatch caused Solarch's multipart parser
to fail validation on unrelated fields too (`title` reported as missing even when present) rather
than raising a clear "unexpected field" error — a minor error-reporting gap worth knowing about
when debugging similar multipart issues with this package.
