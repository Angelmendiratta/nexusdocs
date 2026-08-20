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

  // Already patched: leave it alone.
  if (alreadyPatchedRegex && alreadyPatchedRegex.test(source)) {
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
// PostgreSQL may return passwordHash as passwordhash.
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

  /const passwordHash = row\.passwordHash \?\? row\.passwordhash;/
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
//
// When limit < 0, omit LIMIT/OFFSET entirely.
// =========================================================

patchRegex(
  'core/record_query.js',

  /const rows = await app\.db\(\)\.query\(`SELECT \* FROM \$\{qt\} \$\{whereClause\} ORDER BY \$\{orderBy\} LIMIT \? OFFSET \?`,\s*\[\.\.\.params, limit, offset\]\);/,

  'const query = limit < 0 ? `SELECT * FROM ${qt} ${whereClause} ORDER BY ${orderBy}` : `SELECT * FROM ${qt} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;\n' +
  '    const queryParams = limit < 0 ? params : [...params, limit, offset];\n' +
  '    const rows = await app.db().query(query, queryParams);',

  /const query = limit < 0 \? `SELECT \* FROM \$\{qt\} \$\{whereClause\} ORDER BY \$\{orderBy\}`/
);

console.log('[Solarch patch] PostgreSQL compatibility patch complete.');