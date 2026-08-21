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
// =========================================================

patchRegex(
  'core/record_query.js',

  /exports\.NO_CANDIDATE_LIMIT = -1;/,

  'exports.NO_CANDIDATE_LIMIT = 2147483647;',

  /exports\.NO_CANDIDATE_LIMIT = 2147483647;/
);

// =========================================================
// 5. NexusDocs authorization
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

let recordHelpers = fs.readFileSync(
  recordHelpersPath,
  'utf8'
);

// ---------------------------------------------------------
// Find the complete canAccessRecord function dynamically.
// This avoids depending on whitespace/formatting changes
// between Solarch versions or previous patches.
// ---------------------------------------------------------

const canAccessStart = recordHelpers.indexOf(
  'async function canAccessRecord('
);

if (canAccessStart === -1) {
  throw new Error(
    '[Solarch patch] Could not find canAccessRecord()'
  );
}

// Find the end of canAccessRecord().
// The function ends immediately before:
// async function checkCollectionAccess
const canAccessEnd = recordHelpers.indexOf(
  'async function checkCollectionAccess',
  canAccessStart
);

if (canAccessEnd === -1) {
  throw new Error(
    '[Solarch patch] Could not find end of canAccessRecord()'
  );
}

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

    const authId =
        requestInfo?.auth?.id ??
        requestInfo?.auth?.get?.('id');

    const context = requestInfo?.context;
    const collectionName = collection?.name;

    console.log(
        '[NexusAuth]',
        JSON.stringify({
            collection: collectionName,
            context,
            authId,
            recordId: record?.id,
            workspaceId: record?.get?.('workspace')
        })
    );

    if (!authId) {
        return false;
    }

    // =====================================================
    // WORKSPACES
    // Owner OR member
    // =====================================================

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

    // =====================================================
    // WORKSPACE MEMBERS
    // Only workspace owner can manage members
    // =====================================================

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

    // =====================================================
    // DOCUMENTS
    //
    // Owner  -> full access
    // Editor -> read/write
    // Viewer -> read only
    // Other -> no access
    // =====================================================

    if (collectionName === 'documents') {
        const workspaceId = record.get('workspace');

        // Personal document.
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

        // Workspace owner.
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

        // Viewer and editor can read.
        if (context === 'list' || context === 'view') {
            return true;
        }

        // Only editor can modify.
        return membership.member_role === 'editor';
    }

    // =====================================================
    // COMMENTS
    // =====================================================

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

        // Owner.
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

        // Anyone with workspace access can read comments.
        if (context === 'list' || context === 'view') {
            return true;
        }

        // Users can delete their own comments.
        if (context === 'delete') {
            return record.get('author') === authId;
        }

        // Editors can create/update comments.
        return membership.member_role === 'editor';
    }

    // =====================================================
    // EVERYTHING ELSE
    // Use normal Solarch rule evaluation.
    // =====================================================

    const resolver =
        new record_field_resolver_1.RecordFieldResolver({
            record,
            collection,
            requestInfo,
        });

    return (0, record_field_resolver_1.evaluateRule)(
        rule,
        resolver
    );
}
`;

// Replace whatever version currently exists.
recordHelpers =
    recordHelpers.slice(0, canAccessStart) +
    patchedCanAccess +
    recordHelpers.slice(canAccessEnd);

fs.writeFileSync(
    recordHelpersPath,
    recordHelpers,
    'utf8'
);

console.log(
    '[Solarch patch] NexusDocs authorization patched.'
);

console.log(
    '[Solarch patch] PostgreSQL compatibility patch complete.'
);