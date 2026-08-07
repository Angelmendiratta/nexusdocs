# NexusDocs — Team Knowledge Base Backend (built on Solarch)

A backend for a team knowledge-sharing app: workspaces contain documents, documents have comments and an author, and every meaningful action is logged to an activity feed. Built using the `solarch` npm package (a PocketBase-style backend-as-a-service for Node.js) as the required framework.

## Stack

- **Solarch** (v0.15.6) — auto-generated REST API, SQLite storage, built-in auth, collection/schema management
- **Node.js 20 LTS**
- Access controlled entirely through Solarch's declarative API Rules (no custom route code needed for CRUD)

## Features implemented

1. **Auth** — email/password signup and login via Solarch's built-in `auth`-type collection, JWT-based sessions
2. **Relational CRUD** — `workspaces → documents → comments`, each properly linked via relation fields
3. **Role-based permissions** — API Rules enforce that only a workspace's owner can update/delete it, and only a document/comment's author can edit or delete their own content, while any authenticated user can read and create
4. **File attachments** — `documents` collection includes a file field for uploads
5. **Semantic search readiness** — `documents` includes a 1536-dim vector field (`embedding`) wired to Solarch's cosine-similarity vector search endpoint
6. **Activity logging** — every workspace/document/comment creation is recorded in an `activity_log` collection, implemented at the application layer (see "Known Issues" below for why)

## Schema

| Collection | Type | Key fields |
|---|---|---|
| `users` | auth | `email`, `password`, `name` |
| `workspaces` | base | `wname`, `owner` (→users), `members` (→users, many) |
| `documents` | base | `title`, `content`, `workspace` (→workspaces), `author` (→users), `attachment` (file), `embedding` (vector) |
| `comments` | base | `text`, `document` (→documents), `author` (→users) |
| `activity_log` | base | `action`, `details`, `user` (→users), `workspace` (→workspaces) |

## API Rules set on each collection

- `workspaces`: list/view/create require auth; update/delete require `@request.auth.id = owner`
- `documents`: list/view/create/update require auth; delete requires `@request.auth.id = author`
- `comments`: list/view/create require auth; update/delete require `@request.auth.id = author`
- `activity_log`: list/view/create require auth

## Setup

```bash
git clone <this-repo>
cd nexusdocs
npm install
```

Solarch requires a JWT secret (min 32 chars) set as an environment variable before it will start:

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

On first run, no superuser exists yet. The Admin UI's install screen is broken in this package version (see Known Issues), so create the superuser via CLI instead:

```bash
npx solarch superuser-create admin@example.com YourPassword123
```

Then restart the server. The REST API is live at `http://localhost:8090/api/`.

## Recreating the schema

The collections in this project were created via `curl`/`Invoke-RestMethod` calls against `POST /api/collections` using the admin token (see `setup-commands.md` for the exact commands run, in order). Solarch's migration system (`pb_migrations/`) is documented but wasn't used here since collection creation via the Admin API was more directly verifiable step-by-step during development.

## Known Issues (found while building this)

One real bug and one documentation/implementation mismatch were found in `solarch@0.15.6` by reading the compiled source in `node_modules/solarch/dist/` rather than assuming from behavior alone:

### 1. `pb_hooks` record-create hooks never fire

`dist/tools/jsvm/jsvm.js` registers `onRecordCreate(tag, handler)` in the hook sandbox, but the callback is bound with `app.onRecordCreate.bindFunc(handler)` — the `tag` argument is silently discarded (no per-collection filtering), **and** nothing in `dist/apis/record_crud.js`'s create handler ever calls `.trigger()` on that hook object. So no JS hook file can ever run on record creation, regardless of how it's written.

**Verified by**: writing a minimal hook that only logs on load and on fire; the "load" log printed every server start, the "fire" log never printed after creating records via the API.

**Workaround used**: activity logging is done at the application/client layer — after each `documents`/`comments`/`workspaces` create call, a second call writes a matching row to `activity_log` directly.

### 2. WebSocket realtime works, but channel names use collection ID, not name (undocumented)

Initially this looked like a second broken feature — a subscribed, authenticated WebSocket client never received events after creating records. Reading `dist/apis/record_crud.js` showed `broadcastRecordEvent('create', collection.id, ...)` **is** correctly called on every create/update/delete. The actual cause: `broadcastRecordEvent` builds the channel string as `collections.${collectionId}.records` using the collection's **ID** (e.g. `msho2p183d460397`), while the README's example subscribes using the collection **name** (`collections.posts.records`). Subscribing to the ID-based channel instead works correctly and was verified live — connect, authenticate via `?token=`, subscribe to `collections.<collectionId>.records`, then a REST create immediately pushes a matching `{"type":"event",...}` message to the client.

**Takeaway**: realtime is fully functional; the README's realtime example is misleading/outdated since it uses collection names where the implementation expects collection IDs.

### 3. npm package occasionally fails to fully extract on Windows

Global install (`npm install -g solarch`) intermittently left an incomplete `node_modules/solarch` folder (only its own `node_modules` subfolder, missing `package.json`/`dist`) after an earlier failed install left EPERM-locked files behind. A local install (`npm install solarch` inside a project with its own `package.json`) resolved this reliably. Also required Node 20 LTS rather than Node 24, since `better-sqlite3` (a native dependency) has no Node 24 Windows prebuild yet and compiling from source requires Visual Studio Build Tools.

## What I'd do next with more time

- Patch and PR the `pb_hooks` bug upstream, and suggest a doc fix for the realtime channel-naming example
- Wire up actual embedding generation (OpenAI or local Ollama) for the vector search feature to be fully live rather than schema-ready
- Add integration tests
- Containerize with the Dockerfile pattern from the package docs
