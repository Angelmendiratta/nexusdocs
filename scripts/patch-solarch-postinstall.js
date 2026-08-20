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

console.log('[Solarch patch] PostgreSQL compatibility patch complete.');