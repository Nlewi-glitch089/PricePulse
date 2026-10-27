// Regression tests for where the MongoDB connection string comes from.
// The URIs below are fake; no credentials are real or printed.
process.env.NODE_ENV = 'test';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readDatabaseConfig, connectToDatabase, describeUri } = require('../database/db');

const ROOT = path.resolve(__dirname, '..');
const FAKE_ATLAS_URI = 'mongodb+srv://pp_user:p%40ss=w0rd!@cluster0.abc12.mongodb.net/?retryWrites=true&w=majority&appName=PricePulse';

// Load an .env file the same way `npm start` does and report what the app resolves.
function resolveWithEnvFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricepulse-env-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, contents);
  const script = `
    const { readDatabaseConfig, describeUri } = require(${JSON.stringify(path.join(ROOT, 'database', 'db.js'))});
    const { uri, dbName } = readDatabaseConfig();
    console.log(JSON.stringify({ host: describeUri(uri), dbName, matches: uri === ${JSON.stringify(FAKE_ATLAS_URI)} }));`;
  const env = { ...process.env };
  delete env.MONGODB_URI; // a variable already in the environment would win over .env
  delete env.MONGODB_DB;
  try {
    return JSON.parse(execFileSync(process.execPath, [`--env-file-if-exists=${envFile}`, '-e', script], { env, encoding: 'utf8' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('MongoDB configuration', () => {
  test('an Atlas URI in .env is used exactly as written, not replaced by localhost', () => {
    const result = resolveWithEnvFile(`# comment\nMONGODB_URI=${FAKE_ATLAS_URI}\nMONGODB_DB=pricepulse\nSESSION_SECRET=x\n`);
    assert.equal(result.host, 'mongodb+srv://cluster0.abc12.mongodb.net');
    assert.equal(result.matches, true);
    assert.equal(result.dbName, 'pricepulse');
  });

  test('a quoted Atlas URI works too', () => {
    const result = resolveWithEnvFile(`MONGODB_URI="${FAKE_ATLAS_URI}"\n`);
    assert.equal(result.matches, true);
  });

  test('.env.example has no connection string, so an unedited copy cannot silently use localhost', () => {
    const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const lines = example.split(/\r?\n/).filter((l) => /^\s*MONGODB_URI\s*=/.test(l));
    assert.deepEqual(lines, ['MONGODB_URI=']);
    assert.equal(resolveWithEnvFile(example).host, '(unreadable MONGODB_URI)');
  });

  test('there is no hidden default URI, and start-up refuses to run without one', async () => {
    assert.equal(readDatabaseConfig({}).uri, '');
    assert.equal(readDatabaseConfig({}).dbName, 'pricepulse');
    await assert.rejects(connectToDatabase(readDatabaseConfig({}).uri, 'pricepulse'), /MONGODB_URI is not set/);
  });

  test('log descriptions never include the username or password', () => {
    const described = describeUri(FAKE_ATLAS_URI);
    assert.doesNotMatch(described, /pp_user|w0rd/);
  });
});
