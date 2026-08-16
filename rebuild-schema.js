// rebuild-schema.js
// Manual recovery tool (kept in sync with auto-setup-and-serve.js, which now
// does this automatically on every boot — this script is a backup/manual option).
//
// Usage:
//   node rebuild-schema.js <BASE_URL> <ADMIN_EMAIL> <ADMIN_PASSWORD>

const [,, BASE, EMAIL, PASSWORD] = process.argv;

if (!BASE || !EMAIL || !PASSWORD) {
  console.error('Usage: node rebuild-schema.js <BASE_URL> <ADMIN_EMAIL> <ADMIN_PASSWORD>');
  process.exit(1);
}

async function req(path, method, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log('Logging in as admin...');
  const { token } = await req('/api/admins/auth-with-password', 'POST', { identity: EMAIL, password: PASSWORD });
  console.log('Admin token acquired.\n');

  console.log('Creating users collection...');
  const users = await req('/api/collections', 'POST', {
    name: 'users', type: 'auth', fields: [{ name: 'name', type: 'text' }],
  }, token);
  console.log('  users:', users.id);
  await req(`/api/collections/${users.id}`, 'PATCH', { createRule: '' }, token);
  console.log('  users: public signup enabled\n');

  console.log('Creating workspaces collection...');
  const workspaces = await req('/api/collections', 'POST', {
    name: 'workspaces', type: 'base',
    fields: [
      { name: 'wname', type: 'text', required: true },
      { name: 'owner', type: 'relation', collectionId: users.id },
      { name: 'members', type: 'relation', collectionId: users.id, maxSelect: 999 },
    ],
  }, token);
  console.log('  workspaces:', workspaces.id, '\n');

  console.log('Creating workspace_members collection (RBAC)...');
  const workspaceMembers = await req('/api/collections', 'POST', {
    name: 'workspace_members', type: 'base',
    fields: [
      { name: 'workspace', type: 'relation', collectionId: workspaces.id, required: true },
      { name: 'user', type: 'relation', collectionId: users.id, required: true },
      { name: 'role', type: 'select', values: ['owner', 'editor', 'viewer'], required: true },
    ],
  }, token);
  console.log('  workspace_members:', workspaceMembers.id, '\n');

  console.log('Creating documents collection...');
  const documents = await req('/api/collections', 'POST', {
    name: 'documents', type: 'base',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'content', type: 'editor' },
      { name: 'workspace', type: 'relation', collectionId: workspaces.id },
      { name: 'author', type: 'relation', collectionId: users.id },
      { name: 'attachment', type: 'file' },
      { name: 'embedding', type: 'vector', dimensions: 1536 },
    ],
  }, token);
  console.log('  documents:', documents.id, '\n');

  console.log('Creating comments collection...');
  const comments = await req('/api/collections', 'POST', {
    name: 'comments', type: 'base',
    fields: [
      { name: 'text', type: 'text', required: true },
      { name: 'document', type: 'relation', collectionId: documents.id },
      { name: 'author', type: 'relation', collectionId: users.id },
    ],
  }, token);
  console.log('  comments:', comments.id, '\n');

  console.log('Creating activity_log collection...');
  const activity = await req('/api/collections', 'POST', {
    name: 'activity_log', type: 'base',
    fields: [
      { name: 'action', type: 'text', required: true },
      { name: 'details', type: 'text' },
      { name: 'user', type: 'relation', collectionId: users.id },
      { name: 'workspace', type: 'relation', collectionId: workspaces.id },
    ],
  }, token);
  console.log('  activity_log:', activity.id, '\n');

  console.log('Setting API rules...');
  const authRule = '@request.auth.id != ""';

  await req(`/api/collections/${workspaces.id}`, 'PATCH', {
    listRule: authRule, viewRule: authRule, createRule: authRule,
    updateRule: '@request.auth.id = owner', deleteRule: '@request.auth.id = owner',
  }, token);

  await req(`/api/collections/${workspaceMembers.id}`, 'PATCH', {
    listRule: authRule, viewRule: authRule, createRule: authRule,
    updateRule: authRule, deleteRule: '@request.auth.id = user',
  }, token);

  await req(`/api/collections/${documents.id}`, 'PATCH', {
    listRule: '@request.auth.id = author', viewRule: '@request.auth.id = author',
    createRule: authRule, updateRule: authRule, deleteRule: '@request.auth.id = author',
  }, token);

  await req(`/api/collections/${comments.id}`, 'PATCH', {
    listRule: '@request.auth.id = author', viewRule: '@request.auth.id = author',
    createRule: authRule, updateRule: '@request.auth.id = author', deleteRule: '@request.auth.id = author',
  }, token);

  await req(`/api/collections/${activity.id}`, 'PATCH', {
    listRule: authRule, viewRule: authRule, createRule: authRule,
  }, token);

  console.log('All API rules set.\n');
  console.log('========================================');
  console.log('SCHEMA REBUILD COMPLETE');
  console.log('========================================');
  console.log('Collection IDs:');
  console.log('  users:            ', users.id);
  console.log('  workspaces:       ', workspaces.id);
  console.log('  workspace_members:', workspaceMembers.id);
  console.log('  documents:        ', documents.id);
  console.log('  comments:         ', comments.id);
  console.log('  activity_log:     ', activity.id);
}

main().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});