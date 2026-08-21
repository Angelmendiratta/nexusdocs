'use strict';

const fs = require('fs');
const path = require('path');

const solarchDist = path.join(
  process.cwd(),
  'node_modules',
  'solarch',
  'dist'
);

function patchRegex(relativePath, regex, replacement, alreadyPatchedRegex) {
  const filePath = path.join(solarchDist, relativePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`[Solarch patch] Missing file: ${filePath}`);
  }

  let source = fs.readFileSync(filePath, 'utf8');

  // If this version is already patched, do nothing.
  if (alreadyPatchedRegex.test(source)) {
    console.log(`[Solarch patch] Already patched ${relativePath}`);
    return;
  }

  if (!regex.test(source)) {
    throw new Error(
      `[Solarch patch] Expected code not found in ${relativePath}`
    );
  }

  source = source.replace(regex, replacement);

  fs.writeFileSync(filePath, source, 'utf8');

  console.log(`[Solarch patch] Patched ${relativePath}`);
}

// =========================================================
// 1. admin_auth.js
// PostgreSQL can return passwordHash as passwordhash.
// =========================================================

patchRegex(
  'apis/admin_auth.js',

  /const valid = await \(0, crypto_1\.verifyPassword\)\(password,\s*row\.passwordHash\);/,

  'const valid = await (0, crypto_1.verifyPassword)(password, row.passwordHash ?? row.passwordhash);',

  /row\.passwordHash\s*\?\?\s*row\.passwordhash/
);

// =========================================================
// 2. record_auth.js
// =========================================================

patchRegex(
  'apis/record_auth.js',

  /const passwordHash = row\.passwordHash;/,

  'const passwordHash = row.passwordHash ?? row.passwordhash;',

  /const passwordHash = row\.passwordHash\s*\?\?\s*row\.passwordhash;/
);

patchRegex(
  'apis/record_auth.js',

  /SET lastLoginAt = \?/g,

  'SET "lastLoginAt" = ?',

  /SET "lastLoginAt" = \?/
);

// =========================================================
// 3. auth_flows.js
// =========================================================

patchRegex(
  'apis/auth_flows.js',

  /SET lastResetSentAt = \?/g,

  'SET "lastResetSentAt" = ?',

  /SET "lastResetSentAt" = \?/
);

patchRegex(
  'apis/auth_flows.js',

  /SET passwordHash = \?/g,

  'SET "passwordHash" = ?',

  /SET "passwordHash" = \?/
);

patchRegex(
  'apis/auth_flows.js',

  /SET lastVerificationSentAt = \?/g,

  'SET "lastVerificationSentAt" = ?',

  /SET "lastVerificationSentAt" = \?/
);

// =========================================================
// 4. record_query.js
//
// Solarch uses -1 as NO_CANDIDATE_LIMIT.
// PostgreSQL rejects LIMIT -1.
// Replace -1 with a large positive value.
// =========================================================

patchRegex(
  'core/record_query.js',

  /exports\.NO_CANDIDATE_LIMIT = -1;/,

  'exports.NO_CANDIDATE_LIMIT = 2147483647;',

  /exports\.NO_CANDIDATE_LIMIT = 2147483647;/
);

// =========================================================
// NexusDocs authorization patch
// =========================================================

const recordHelpersPath = path.join(
  solarchDist,
  'apis',
  'record_helpers.js'
);

if (!fs.existsSync(recordHelpersPath)) {
  throw new Error(
    `[Solarch patch] Missing file: ${recordHelpersPath}`
  );
}

let recordHelpers = fs.readFileSync(recordHelpersPath, 'utf8');

const originalCanAccess = `async function canAccessRecord(app, record, collection, rule, requestInfo, skipAdminBypass = false) {
    if (!skipAdminBypass && requestInfo.isAdmin) {
        return true;
    }
    if (rule === '')
        return true;
    if (!rule)
        return false;
    const resolver = new record_field_resolver_1.RecordFieldResolver({
        record,
        collection,
        requestInfo,
    });
    return (0, record_field_resolver_1.evaluateRule)(rule, resolver);
}`;

const patchedCanAccess = `async function canAccessRecord(app, record, collection, rule, requestInfo, skipAdminBypass = false) {
    if (!skipAdminBypass && requestInfo.isAdmin) {
        return true;
    }

    if (rule === '') {
        return true;
    }

    if (!rule) {
        return false;
    }

    const authId = requestInfo?.auth?.id;
    const context = requestInfo?.context;
    const collectionName = collection?.name;

    if (!authId) {
        return false;
    }

    // -----------------------------------------------------
    // WORKSPACES
    // -----------------------------------------------------

    if (collectionName === 'workspaces') {
        const owner = record.get('owner');

        if (owner === authId) {
            return true;
        }

        const membership = await app.db().queryOne(
            'SELECT * FROM "_r_mt1gs8m95bbb08d3" WHERE "workspace" = ? AND "user" = ? LIMIT 1',
            [record.id, authId]
        );

        return !!membership;
    }

    // -----------------------------------------------------
    // WORKSPACE MEMBERS
    // -----------------------------------------------------

    if (collectionName === 'workspace_members') {
        const workspaceId = record.get('workspace');

        if (!workspaceId) {
            return false;
        }

        const workspace = await app.db().queryOne(
            'SELECT * FROM "_r_mt1gs8dsab2a01c2" WHERE id = ? LIMIT 1',
            [workspaceId]
        );

        return !!workspace && workspace.owner === authId;
    }

    // -----------------------------------------------------
    // DOCUMENTS
    // -----------------------------------------------------

    if (collectionName === 'documents') {
        const workspaceId = record.get('workspace');

        // Personal document without a workspace.
        if (!workspaceId) {
            return record.get('author') === authId;
        }

        const workspace = await app.db().queryOne(
            'SELECT * FROM "_r_mt1gs8dsab2a01c2" WHERE id = ? LIMIT 1',
            [workspaceId]
        );

        if (!workspace) {
            return false;
        }

        // Owner has full access.
        if (workspace.owner === authId) {
            return true;
        }

        const membership = await app.db().queryOne(
            'SELECT * FROM "_r_mt1gs8m95bbb08d3" WHERE "workspace" = ? AND "user" = ? LIMIT 1',
            [workspaceId, authId]
        );

        if (!membership) {
            return false;
        }

        // Viewer can only read.
        if (context === 'list' || context === 'view') {
            return true;
        }

        // Editor can write.
        return membership.member_role === 'editor';
    }

    // -----------------------------------------------------
    // COMMENTS
    // -----------------------------------------------------

    if (collectionName === 'comments') {
        const documentId = record.get('document');

        if (!documentId) {
            return false;
        }

        const document = await app.db().queryOne(
            'SELECT * FROM "_r_mt1gs8pbae2d93a4" WHERE id = ? LIMIT 1',
            [documentId]
        );

        if (!document || !document.workspace) {
            return false;
        }

        const workspace = await app.db().queryOne(
            'SELECT * FROM "_r_mt1gs8dsab2a01c2" WHERE id = ? LIMIT 1',
            [document.workspace]
        );

        if (!workspace) {
            return false;
        }

        if (workspace.owner === authId) {
            return true;
        }

        const membership = await app.db().queryOne(
            'SELECT * FROM "_r_mt1gs8m95bbb08d3" WHERE "workspace" = ? AND "user" = ? LIMIT 1',
            [document.workspace, authId]
        );

        if (!membership) {
            return false;
        }

        if (context === 'list' || context === 'view') {
            return true;
        }

        if (context === 'delete') {
            return record.get('author') === authId;
        }

        return membership.member_role === 'editor';
    }

    // -----------------------------------------------------
    // EVERYTHING ELSE
    // -----------------------------------------------------

    const resolver = new record_field_resolver_1.RecordFieldResolver({
        record,
        collection,
        requestInfo,
    });

    return (0, record_field_resolver_1.evaluateRule)(rule, resolver);
}`;

if (recordHelpers.includes(patchedCanAccess)) {
    console.log(
        '[Solarch patch] NexusDocs authorization already patched.'
    );
} else if (recordHelpers.includes(originalCanAccess)) {
    recordHelpers = recordHelpers.replace(
        originalCanAccess,
        patchedCanAccess
    );

    fs.writeFileSync(
        recordHelpersPath,
        recordHelpers,
        'utf8'
    );

    console.log(
        '[Solarch patch] NexusDocs authorization patched.'
    );
} else {
    throw new Error(
        '[Solarch patch] Could not find original canAccessRecord()'
    );
}
console.log('[Solarch patch] PostgreSQL compatibility patch complete.');