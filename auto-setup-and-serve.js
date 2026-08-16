// auto-setup-and-serve.js
//
// Starts Solarch, creates the schema if it is missing, and repairs the
// important collection API rules on every boot.
//
// Render Start Command:
//   node auto-setup-and-serve.js
//
// Recommended Render environment variables:
//
//   ADMIN_EMAIL=admin@example.com
//   ADMIN_PASSWORD=<stable admin password>
//
// If ADMIN_PASSWORD is not set and a superuser does not already exist,
// a random password is generated for this boot and printed to the logs.
// For a persistent deployment, set ADMIN_PASSWORD in Render.

const { spawn, execSync } = require('child_process');
const crypto = require('crypto');

const PORT = process.env.PORT || 8090;
const BASE = `http://localhost:${PORT}`;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('hex');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);

      if (res.ok) {
        return true;
      }
    } catch {
      // Server is still starting.
    }

    await sleep(1000);
  }

  return false;
}

async function req(path, method = 'GET', body = null, token = null) {
  const headers = {};

  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  return {
    ok: res.ok,
    status: res.status,
    data,
  };
}

async function createSuperuserIfNeeded() {
  try {
    execSync(
      `npx solarch superuser-create ${ADMIN_EMAIL} ${ADMIN_PASSWORD}`,
      {
        stdio: 'inherit',
      }
    );

    console.log('========================================');
    console.log('[auto-setup] Superuser created:');
    console.log('[auto-setup] Email:', ADMIN_EMAIL);
    console.log('[auto-setup] Password:', ADMIN_PASSWORD);
    console.log('========================================');
  } catch {
    console.log(
      '[auto-setup] Superuser already exists or could not be created.'
    );
    console.log(
      '[auto-setup] Will try the configured ADMIN_PASSWORD.'
    );
  }
}

async function adminLogin() {
  const login = await req(
    '/api/admins/auth-with-password',
    'POST',
    {
      identity: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    }
  );

  if (!login.ok || !login.data.token) {
    console.log(
      '[auto-setup] Admin login failed.'
    );

    console.log(
      '[auto-setup] Make sure ADMIN_EMAIL and ADMIN_PASSWORD are correct in Render.'
    );

    return null;
  }

  return login.data.token;
}

async function createSchema(token) {
  console.log('[auto-setup] Schema missing — creating collections...');

  // ------------------------------------------------------------
  // USERS
  // ------------------------------------------------------------

  const users = await req(
    '/api/collections',
    'POST',
    {
      name: 'users',
      type: 'auth',
      fields: [
        {
          name: 'name',
          type: 'text',
        },
      ],
    },
    token
  );

  if (!users.ok) {
    throw new Error(
      `Failed creating users: ${JSON.stringify(users.data)}`
    );
  }

  // ------------------------------------------------------------
  // WORKSPACES
  // ------------------------------------------------------------

  const workspaces = await req(
    '/api/collections',
    'POST',
    {
      name: 'workspaces',
      type: 'base',
      fields: [
        {
          name: 'wname',
          type: 'text',
          required: true,
        },
        {
          name: 'owner',
          type: 'relation',
          collectionId: users.data.id,
        },
        {
          name: 'members',
          type: 'relation',
          collectionId: users.data.id,
          maxSelect: 999,
        },
      ],
    },
    token
  );

  if (!workspaces.ok) {
    throw new Error(
      `Failed creating workspaces: ${JSON.stringify(workspaces.data)}`
    );
  }

  // ------------------------------------------------------------
  // WORKSPACE MEMBERS
  // ------------------------------------------------------------

  const workspaceMembers = await req(
    '/api/collections',
    'POST',
    {
      name: 'workspace_members',
      type: 'base',
      fields: [
        {
          name: 'workspace',
          type: 'relation',
          collectionId: workspaces.data.id,
          required: true,
        },
        {
          name: 'user',
          type: 'relation',
          collectionId: users.data.id,
          required: true,
        },
        {
          name: 'role',
          type: 'select',
          values: ['owner', 'editor', 'viewer'],
          required: true,
        },
      ],
    },
    token
  );

  if (!workspaceMembers.ok) {
    throw new Error(
      `Failed creating workspace_members: ${JSON.stringify(
        workspaceMembers.data
      )}`
    );
  }

  // ------------------------------------------------------------
  // DOCUMENTS
  // ------------------------------------------------------------

  const documents = await req(
    '/api/collections',
    'POST',
    {
      name: 'documents',
      type: 'base',
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
        },
        {
          name: 'content',
          type: 'editor',
        },
        {
          name: 'workspace',
          type: 'relation',
          collectionId: workspaces.data.id,
        },
        {
          name: 'author',
          type: 'relation',
          collectionId: users.data.id,
        },
        {
          name: 'attachment',
          type: 'file',
        },
        {
          name: 'embedding',
          type: 'vector',
          dimensions: 1536,
        },
      ],
    },
    token
  );

  if (!documents.ok) {
    throw new Error(
      `Failed creating documents: ${JSON.stringify(
        documents.data
      )}`
    );
  }

  // ------------------------------------------------------------
  // COMMENTS
  // ------------------------------------------------------------

  const comments = await req(
    '/api/collections',
    'POST',
    {
      name: 'comments',
      type: 'base',
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
        },
        {
          name: 'document',
          type: 'relation',
          collectionId: documents.data.id,
        },
        {
          name: 'author',
          type: 'relation',
          collectionId: users.data.id,
        },
      ],
    },
    token
  );

  if (!comments.ok) {
    throw new Error(
      `Failed creating comments: ${JSON.stringify(
        comments.data
      )}`
    );
  }

  // ------------------------------------------------------------
  // ACTIVITY LOG
  // ------------------------------------------------------------

  const activity = await req(
    '/api/collections',
    'POST',
    {
      name: 'activity_log',
      type: 'base',
      fields: [
        {
          name: 'action',
          type: 'text',
          required: true,
        },
        {
          name: 'details',
          type: 'text',
        },
        {
          name: 'user',
          type: 'relation',
          collectionId: users.data.id,
        },
        {
          name: 'workspace',
          type: 'relation',
          collectionId: workspaces.data.id,
        },
      ],
    },
    token
  );

  if (!activity.ok) {
    throw new Error(
      `Failed creating activity_log: ${JSON.stringify(
        activity.data
      )}`
    );
  }

  console.log('[auto-setup] Collections created successfully.');
}

async function getCollections(token) {
  const res = await req(
    '/api/collections',
    'GET',
    null,
    token
  );

  if (!res.ok) {
    throw new Error(
      `Could not list collections: ${JSON.stringify(res.data)}`
    );
  }

  const items = res.data.items || res.data || [];

  const byName = Object.fromEntries(
    items.map(collection => [collection.name, collection])
  );

  const requiredCollections = [
    'users',
    'workspaces',
    'workspace_members',
    'documents',
    'comments',
    'activity_log',
  ];

  for (const name of requiredCollections) {
    if (!byName[name]) {
      throw new Error(
        `Collection "${name}" is missing.`
      );
    }
  }

  return byName;
}

async function repairRules(token, collections) {
  // IMPORTANT:
  // Declare this ONLY ONCE in this function.
  const authRule = '@request.auth.id != ""';

  // ------------------------------------------------------------
  // USERS
  // ------------------------------------------------------------
  //
  // Signup stays public.
  // Authenticated users can search/view existing users.
  // This is required by the Members UI which looks up a user by email.

  const usersResult = await req(
    `/api/collections/${collections.users.id}`,
    'PATCH',
    {
      listRule: authRule,
      viewRule: authRule,
      createRule: '',
    },
    token
  );

  if (!usersResult.ok) {
    console.log(
      '[auto-setup] Failed repairing users rules:',
      JSON.stringify(usersResult.data)
    );
  }

  // ------------------------------------------------------------
  // WORKSPACES
  // ------------------------------------------------------------

  const workspacesResult = await req(
    `/api/collections/${collections.workspaces.id}`,
    'PATCH',
    {
      listRule: authRule,
      viewRule: authRule,
      createRule: authRule,
      updateRule: '@request.auth.id = owner',
      deleteRule: '@request.auth.id = owner',
    },
    token
  );

  if (!workspacesResult.ok) {
    console.log(
      '[auto-setup] Failed repairing workspace rules:',
      JSON.stringify(workspacesResult.data)
    );
  }

  // ------------------------------------------------------------
  // WORKSPACE MEMBERS
  // ------------------------------------------------------------

  const membersResult = await req(
    `/api/collections/${collections.workspace_members.id}`,
    'PATCH',
    {
      listRule: authRule,
      viewRule: authRule,
      createRule: authRule,
      updateRule: authRule,
      deleteRule: '@request.auth.id = user',
    },
    token
  );

  if (!membersResult.ok) {
    console.log(
      '[auto-setup] Failed repairing workspace_members rules:',
      JSON.stringify(membersResult.data)
    );
  }

  // ------------------------------------------------------------
  // DOCUMENTS
  // ------------------------------------------------------------

  const documentsResult = await req(
    `/api/collections/${collections.documents.id}`,
    'PATCH',
    {
      listRule: authRule,
      viewRule: authRule,
      createRule: authRule,
      updateRule: authRule,
      deleteRule: '@request.auth.id = author',
    },
    token
  );

  if (!documentsResult.ok) {
    console.log(
      '[auto-setup] Failed repairing document rules:',
      JSON.stringify(documentsResult.data)
    );
  }

  // ------------------------------------------------------------
  // COMMENTS
  // ------------------------------------------------------------

  const commentsResult = await req(
    `/api/collections/${collections.comments.id}`,
    'PATCH',
    {
      listRule: authRule,
      viewRule: authRule,
      createRule: authRule,
      updateRule: authRule,
      deleteRule: '@request.auth.id = author',
    },
    token
  );

  if (!commentsResult.ok) {
    console.log(
      '[auto-setup] Failed repairing comment rules:',
      JSON.stringify(commentsResult.data)
    );
  }

  // ------------------------------------------------------------
  // ACTIVITY LOG
  // ------------------------------------------------------------

  const activityResult = await req(
    `/api/collections/${collections.activity_log.id}`,
    'PATCH',
    {
      listRule: authRule,
      viewRule: authRule,
      createRule: authRule,
    },
    token
  );

  if (!activityResult.ok) {
    console.log(
      '[auto-setup] Failed repairing activity_log rules:',
      JSON.stringify(activityResult.data)
    );
  }

  console.log('[auto-setup] API rules repaired.');
}

async function ensureSuperuserAndSchema() {
  await createSuperuserIfNeeded();

  const token = await adminLogin();

  if (!token) {
    return;
  }

  let collections;

  // Check whether the schema already exists.
  const workspaceCheck = await req(
    '/api/collections/workspaces/records',
    'GET',
    null,
    token
  );

  if (!workspaceCheck.ok) {
    await createSchema(token);
  } else {
    console.log(
      '[auto-setup] Schema already present.'
    );
  }

  // IMPORTANT:
  // This happens whether the schema was newly created OR already existed.
  // Therefore the updated users/RBAC rules are always repaired.
  collections = await getCollections(token);

  await repairRules(token, collections);

  console.log(
    '[auto-setup] Startup schema/rule checks complete.'
  );
}

async function main() {
  console.log(
    '[auto-setup] Starting Solarch server...'
  );

  const server = spawn(
    'npx',
    ['solarch', 'serve', '--port', PORT],
    {
      stdio: 'inherit',
      shell: true,
    }
  );

  server.on('exit', code => {
    console.log(
      `[auto-setup] Server process exited with code ${code}`
    );

    process.exit(code);
  });

  console.log(
    '[auto-setup] Waiting for server to be ready...'
  );

  const ready = await waitForServer();

  if (!ready) {
    console.error(
      '[auto-setup] Server did not become ready in time.'
    );

    process.exit(1);
  }

  try {
    await ensureSuperuserAndSchema();
  } catch (err) {
    console.error(
      '[auto-setup] Startup setup failed:',
      err.message
    );
  }

  console.log(
    '[auto-setup] Server is running.'
  );
}

main();