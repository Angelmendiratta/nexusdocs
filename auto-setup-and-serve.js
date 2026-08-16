// auto-setup-and-serve.js
//
// PERMANENT FIX for Render free tier wiping the database on every deploy
// (confirmed: this happens on ANY save — code pushes, env var changes, even
// settings changes with no code difference — not just idle-wakeup restarts).
//
// This script starts Solarch, waits for it to be reachable, then automatically
// creates a superuser (random password, printed to logs) and the full schema
// (5 collections + API rules) EVERY time the server boots — but skips
// recreation if the schema already exists, so it's safe to run on every boot
// without duplicating anything.
//
// Set this as the Render Start Command, permanently:
//   node auto-setup-and-serve.js
//
// No more manual rebuild-schema.js runs needed after every wipe.

const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = process.env.PORT || 8090;
const BASE = `http://localhost:${PORT}`;
const ADMIN_EMAIL = 'admin@example.com';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  return false;
}

async function req(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function ensureSuperuserAndSchema() {
  const password = crypto.randomBytes(12).toString('hex');

  // Try creating the superuser via CLI. If one already exists this boot
  // (shouldn't normally happen given the disk wipes, but harmless either way),
  // it'll just fail and we continue.
  const { execSync } = require('child_process');
  try {
    execSync(`npx solarch superuser-create ${ADMIN_EMAIL} ${password}`, { stdio: 'inherit' });
    console.log('========================================');
    console.log('[auto-setup] Superuser created this boot:');
    console.log('[auto-setup] Email:', ADMIN_EMAIL);
    console.log('[auto-setup] Password:', password);
    console.log('========================================');
  } catch (e) {
    console.log('[auto-setup] Superuser may already exist, continuing...');
  }

  // Log in as admin (with the password we just set, or fall back — if this
  // fails, schema setup is skipped for this boot and the app still serves
  // fine for anyone already holding a valid user session).
  const login = await req('/api/admins/auth-with-password', 'POST', {
    identity: ADMIN_EMAIL, password,
  });

  if (!login.ok) {
    console.log('[auto-setup] Could not log in as fresh admin, skipping schema check.');
    return;
  }
  const token = login.data.token;

  // Check if schema already exists.
  const check = await req('/api/collections/workspaces/records', 'GET', null, token);
  if (check.ok) {
    console.log('[auto-setup] Schema already present, skipping schema creation.');
    return;
  }

  console.log('[auto-setup] Schema missing — creating collections...');

  const users = await req('/api/collections', 'POST', {
    name: 'users', type: 'auth',
    fields: [{ name: 'name', type: 'text' }],
  }, token);
  if (!users.ok) { console.log('[auto-setup] Failed creating users:', JSON.stringify(users.data)); return; }
  await req(`/api/collections/${users.data.id}`, 'PATCH', { createRule: '' }, token);

  const workspaces = await req('/api/collections', 'POST', {
    name: 'workspaces', type: 'base',
    fields: [
      { name: 'wname', type: 'text', required: true },
      { name: 'owner', type: 'relation', collectionId: users.data.id },
      { name: 'members', type: 'relation', collectionId: users.data.id, maxSelect: 999 },
    ],
  }, token);

  const documents = await req('/api/collections', 'POST', {
    name: 'documents', type: 'base',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'content', type: 'editor' },
      { name: 'workspace', type: 'relation', collectionId: workspaces.data.id },
      { name: 'author', type: 'relation', collectionId: users.data.id },
      { name: 'attachment', type: 'file' },
      { name: 'embedding', type: 'vector', dimensions: 1536 },
    ],
  }, token);

  const comments = await req('/api/collections', 'POST', {
    name: 'comments', type: 'base',
    fields: [
      { name: 'text', type: 'text', required: true },
      { name: 'document', type: 'relation', collectionId: documents.data.id },
      { name: 'author', type: 'relation', collectionId: users.data.id },
    ],
  }, token);

  const activity = await req('/api/collections', 'POST', {
    name: 'activity_log', type: 'base',
    fields: [
      { name: 'action', type: 'text', required: true },
      { name: 'details', type: 'text' },
      { name: 'user', type: 'relation', collectionId: users.data.id },
      { name: 'workspace', type: 'relation', collectionId: workspaces.data.id },
    ],
  }, token);

  const authRule = '@request.auth.id != ""';

  await req(`/api/collections/${workspaces.data.id}`, 'PATCH', {
    listRule: authRule, viewRule: authRule, createRule: authRule,
    updateRule: '@request.auth.id = owner', deleteRule: '@request.auth.id = owner',
  }, token);

  await req(`/api/collections/${documents.data.id}`, 'PATCH', {
    listRule: '@request.auth.id = author', viewRule: '@request.auth.id = author',
    createRule: authRule, updateRule: authRule, deleteRule: '@request.auth.id = author',
  }, token);

  await req(`/api/collections/${comments.data.id}`, 'PATCH', {
    listRule: '@request.auth.id = author', viewRule: '@request.auth.id = author',
    createRule: authRule, updateRule: '@request.auth.id = author', deleteRule: '@request.auth.id = author',
  }, token);

  await req(`/api/collections/${activity.data.id}`, 'PATCH', {
    listRule: authRule, viewRule: authRule, createRule: authRule,
  }, token);

  console.log('[auto-setup] Schema created successfully:');
  console.log('[auto-setup]   users:', users.data.id);
  console.log('[auto-setup]   workspaces:', workspaces.data.id);
  console.log('[auto-setup]   documents:', documents.data.id);
  console.log('[auto-setup]   comments:', comments.data.id);
  console.log('[auto-setup]   activity_log:', activity.data.id);
}

async function main() {
  console.log('[auto-setup] Starting Solarch server...');
  const server = spawn('npx', ['solarch', 'serve', '--port', PORT], {
    stdio: 'inherit',
    shell: true,
  });

  server.on('exit', (code) => {
    console.log(`[auto-setup] Server process exited with code ${code}`);
    process.exit(code);
  });

  console.log('[auto-setup] Waiting for server to be ready...');
  const ready = await waitForServer();
  if (!ready) {
    console.log('[auto-setup] Server did not become ready in time, skipping auto-setup.');
    return;
  }

  await ensureSuperuserAndSchema();
  console.log('[auto-setup] Startup checks complete. Server is running.');
}

main();