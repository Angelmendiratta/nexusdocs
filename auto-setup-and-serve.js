// auto-setup-and-serve.js
//
// Starts Solarch, creates the schema if it is missing, and repairs
// collection API rules on every boot.
//
// Render Start Command:
//   node auto-setup-and-serve.js
//
// Recommended Render environment variables:
//
//   ADMIN_EMAIL=admin@example.com
//   ADMIN_PASSWORD=<stable-admin-password>

const { spawn, execSync } = require('child_process');
const crypto = require('crypto');

const PORT = process.env.PORT || 8090;
const BASE = `http://localhost:${PORT}`;

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || 'admin@example.com';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  crypto.randomBytes(12).toString('hex');

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
      // Solarch is still starting.
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
    console.log('[auto-setup] Superuser created');
    console.log('[auto-setup] Email:', ADMIN_EMAIL);
    console.log('[auto-setup] Password:', ADMIN_PASSWORD);
    console.log('========================================');
  } catch {
    console.log(
      '[auto-setup] Superuser already exists or could not be created.'
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
    console.log('[auto-setup] Admin login failed.');
    console.log(
      '[auto-setup] Check ADMIN_EMAIL and ADMIN_PASSWORD in Render.'
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
          // IMPORTANT:
          // Use text instead of select. The frontend already restricts
          // this to "editor" or "viewer", while the owner role is handled
          // by workspace.owner.
          name: 'role',
          type: 'text',
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
      `Failed creating documents: ${JSON.stringify(documents.data)}`
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
      `Failed creating comments: ${JSON.stringify(comments.data)}`
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
      `Failed creating activity_log: ${JSON.stringify(activity.data)}`
    );
  }

  console.log('[auto-setup] Collections created.');
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

  const required = [
    'users',
    'workspaces',
    'workspace_members',
    'documents',
    'comments',
    'activity_log',
  ];

  for (const name of required) {
    if (!byName[name]) {
      throw new Error(`Collection "${name}" is missing.`);
    }
  }

  return byName;
}

async function repairWorkspaceMembersField(token, collection) {
  console.log(
    '[auto-setup] Checking workspace_members.role field...'
  );

  // Fetch the complete collection definition.
  const result = await req(
    `/api/collections/${collection.id}`,
    'GET',
    null,
    token
  );

  if (!result.ok) {
    console.log(
      '[auto-setup] Could not inspect workspace_members schema:',
      JSON.stringify(result.data)
    );
    return;
  }

  const current = result.data;

  if (!Array.isArray(current.fields)) {
    console.log(
      '[auto-setup] workspace_members has no readable fields array; skipping field migration.'
    );
    return;
  }

  const roleField = current.fields.find(
    field => field.name === 'role'
  );

  if (!roleField) {
    console.log(
      '[auto-setup] role field is missing. Adding it...'
    );

    const newFields = [
      ...current.fields,
      {
        name: 'role',
        type: 'text',
        required: true,
      },
    ];

    const patch = await req(
      `/api/collections/${collection.id}`,
      'PATCH',
      {
        fields: newFields,
      },
      token
    );

    if (!patch.ok) {
      console.log(
        '[auto-setup] Failed adding role field:',
        JSON.stringify(patch.data)
      );
    } else {
      console.log(
        '[auto-setup] role field added as required text.'
      );
    }

    return;
  }

  if (roleField.type === 'text') {
    console.log(
      '[auto-setup] workspace_members.role is already a text field.'
    );
    return;
  }

  // If role is still the old select field, attempt to convert it.
  console.log(
    `[auto-setup] workspace_members.role is "${roleField.type}". Converting to text...`
  );

  const updatedFields = current.fields.map(field => {
    if (field.name !== 'role') {
      return field;
    }

    // Preserve everything else we can, but replace the field type.
    const replacement = {
      ...field,
      type: 'text',
      required: true,
    };

    // Remove select-specific properties if present.
    delete replacement.options;
    delete replacement.values;
    delete replacement.maxSelect;
    delete replacement.collectionId;

    return replacement;
  });

  const patch = await req(
    `/api/collections/${collection.id}`,
    'PATCH',
    {
      fields: updatedFields,
    },
    token
  );

  if (!patch.ok) {
    console.log(
      '[auto-setup] Could not migrate role field automatically:',
      JSON.stringify(patch.data)
    );

    console.log(
      '[auto-setup] Open Solarch admin → workspace_members → role and change it to required text.'
    );
  } else {
    console.log(
      '[auto-setup] workspace_members.role converted to required text.'
    );
  }
}

async function repairRules(token, collections) {
  const authRule = '@request.auth.id != ""';

  // ------------------------------------------------------------
  // USERS
  // ------------------------------------------------------------

  const usersResult = await req(
    `/api/collections/${collections.users.id}`,
    'PATCH',
    {
      listRule: authRule,
      viewRule: authRule,

      // Public signup.
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

  await req(
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

  // ------------------------------------------------------------
  // WORKSPACE MEMBERS
  // ------------------------------------------------------------

  await req(
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

  // ------------------------------------------------------------
  // DOCUMENTS
  // ------------------------------------------------------------

  await req(
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

  // ------------------------------------------------------------
  // COMMENTS
  // ------------------------------------------------------------

  await req(
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

  // ------------------------------------------------------------
  // ACTIVITY LOG
  // ------------------------------------------------------------

  await req(
    `/api/collections/${collections.activity_log.id}`,
    'PATCH',
    {
      listRule: authRule,
      viewRule: authRule,
      createRule: authRule,
    },
    token
  );

  console.log('[auto-setup] API rules repaired.');
}

async function ensureSuperuserAndSchema() {
  await createSuperuserIfNeeded();

  const token = await adminLogin();

  if (!token) {
    return;
  }

  let collections;

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

  collections = await getCollections(token);

  // IMPORTANT:
  // This runs even when the schema already existed.
  await repairWorkspaceMembersField(
    token,
    collections.workspace_members
  );

  await repairRules(
    token,
    collections
  );

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
    [
      'solarch',
      'serve',
      '--port',
      PORT,
    ],
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