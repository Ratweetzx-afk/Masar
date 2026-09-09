'use strict';

// Run locally once: node scripts/hash-password.js "YourStrongPassword123!"
// Copy the printed hash + salt into schema.sql's seed INSERT statement
// (or run the UPDATE shown at the end directly in Supabase's SQL editor).
// This script never sends your password anywhere — it only runs on your
// own machine and prints the result to your own terminal.

const crypto = require('crypto');

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('Usage: node hash-password.js "YourStrongPassword123!"');
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

console.log('\nAdmin password hash generated.\n');
console.log('password_hash:', hash);
console.log('password_salt:', salt);
console.log('\nRun this in Supabase → SQL Editor:\n');
console.log(
  `insert into admin_auth (id, password_hash, password_salt) values (1, '${hash}', '${salt}')\n` +
    `on conflict (id) do update set password_hash = excluded.password_hash, password_salt = excluded.password_salt, failed_attempts = 0, locked_until = null;`,
);
