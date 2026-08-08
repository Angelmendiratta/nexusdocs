const crypto = require('crypto');
const { execSync } = require('child_process');

const email = 'admin@example.com';
const password = crypto.randomBytes(12).toString('hex'); // random, never committed

console.log('========================================');
console.log('GENERATED ADMIN CREDENTIALS (copy these now):');
console.log('Email:', email);
console.log('Password:', password);
console.log('========================================');

try {
  execSync(`npx solarch superuser-create ${email} ${password}`, { stdio: 'inherit' });
} catch (e) {
  console.log('Superuser may already exist, continuing...');
}