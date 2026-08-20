'use strict';

const fs = require('fs');
const path = require('path');

const solarchRoot = path.join(
  process.cwd(),
  'node_modules',
  'solarch',
  'dist',
  'apis'
);

function patchFile(relativePath, replacements) {
  const filePath = path.join(
    process.cwd(),
    'node_modules',
    'solarch',
    'dist',
    relativePath
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(`[Solarch patch] Missing file: ${filePath}`);
  }

  let source = fs.readFileSync(filePath, 'utf8');

  for (const { oldText, newText, expectedCount = 1 } of replacements) {
    const count = source.split(oldText).length - 1;

    if (count === 0) {
      // Already patched.
      if (source.includes(newText)) {
        continue;
      }

      throw new Error(
        `[Solarch patch] Expected text not found in ${relativePath}:\n${oldText}`
      );
    }

    if (count !== expectedCount) {
      throw new Error(
        `[Solarch patch] Expected ${expectedCount} occurrence(s) of text in ${fileName}, found ${count}:\n${oldText}`
      );
    }

    source = source.split(oldText).join(newText);
  }

  fs.writeFileSync(filePath, source, 'utf8');
  console.log(`[Solarch patch] Patched ${relativePath}`);
}

if (!fs.existsSync(solarchRoot)) {
  throw new Error(
    `[Solarch patch] Solarch is not installed at ${solarchRoot}`
  );
}

// ---------------------------------------------------------
// admin_auth.js
// PostgreSQL may return passwordHash as passwordhash.
// ---------------------------------------------------------

patchFile('apis/admin_auth.js', [
  {
    oldText:
      'const valid = await (0, crypto_1.verifyPassword)(password, row.passwordHash);',

    newText:
      'const valid = await (0, crypto_1.verifyPassword)(password, row.passwordHash ?? row.passwordhash);',
  },
]);

// ---------------------------------------------------------
// record_auth.js
// ---------------------------------------------------------

patchFile('apis/record_auth.js', [
  {
    oldText:
      'const passwordHash = row.passwordHash;',

    newText:
      'const passwordHash = row.passwordHash ?? row.passwordhash;',
  },

  {
    oldText: 'SET lastLoginAt = ?',

    newText: 'SET "lastLoginAt" = ?',

    expectedCount: 3,
  },
]);

// ---------------------------------------------------------
// auth_flows.js
// ---------------------------------------------------------

patchFile('apis/auth_flows.js', [
  {
    oldText: 'SET lastResetSentAt = ?',

    newText: 'SET "lastResetSentAt" = ?',
  },

  {
    oldText: 'SET passwordHash = ?',

    newText: 'SET "passwordHash" = ?',
  },

  {
    oldText: 'SET lastVerificationSentAt = ?',

    newText: 'SET "lastVerificationSentAt" = ?',
  },
]);
patchFile('core/record_query.js', [
  {
    oldText:
      'const rows = await app.db().query(`SELECT * FROM ${qt} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, limit, offset]);',

    newText:
  'const query = limit < 0 ? `SELECT * FROM ${qt} ${whereClause} ORDER BY ${orderBy}` : `SELECT * FROM ${qt} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`; const queryParams = limit < 0 ? params : [...params, limit, offset]; const rows = await app.db().query(query, queryParams);',
  },
]);
console.log('[Solarch patch] PostgreSQL compatibility patch complete.');