// One-off migration: copies the employees, equipment, and misclogs
// collections from an old MongoDB Atlas cluster into the new one this app
// is now configured to use (whatever MONGO_URI / MONGO_DB_NAME are in .env).
//
// The OLD cluster's connection string is intentionally NOT read from .env -
// it's a one-time source you shouldn't leave sitting in a file. Pass it
// inline as an environment variable when you run the script instead, so it
// never touches disk:
//
//   OLD_MONGO_URI="mongodb+srv://old-user:old-pass@old-cluster.mongodb.net/?appName=..." \
//     node scripts/migrate-database.js
//
// (On Windows PowerShell, set it first: $env:OLD_MONGO_URI = "..."; then run
// `node scripts/migrate-database.js`.)
//
// Optional: OLD_MONGO_DB_NAME if the old database's name differs from
// MONGO_DB_NAME (defaults to the same name).
//
// Safety: refuses to overwrite any target collection that already has
// documents, unless you pass --force.

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { COLLECTIONS } = require('../constants');

const SOURCE_URI = process.env.OLD_MONGO_URI;
const SOURCE_DB_NAME = process.env.OLD_MONGO_DB_NAME || process.env.MONGO_DB_NAME || 'inventory';
const TARGET_URI = process.env.MONGO_URI;
const TARGET_DB_NAME = process.env.MONGO_DB_NAME || 'inventory';
const FORCE = process.argv.includes('--force');

async function migrate() {
  if (!SOURCE_URI) {
    console.error(
      'OLD_MONGO_URI is not set. Pass the old cluster\'s connection string inline, e.g.:\n' +
        '  OLD_MONGO_URI="mongodb+srv://..." node scripts/migrate-database.js'
    );
    process.exit(1);
  }
  if (!TARGET_URI) {
    console.error('MONGO_URI is not set in .env - that should already point at your new database.');
    process.exit(1);
  }
  if (SOURCE_URI === TARGET_URI) {
    console.error('OLD_MONGO_URI and MONGO_URI are identical - nothing to migrate.');
    process.exit(1);
  }

  const sourceClient = new MongoClient(SOURCE_URI);
  const targetClient = new MongoClient(TARGET_URI);

  try {
    await sourceClient.connect();
    await targetClient.connect();
  } catch (err) {
    console.error('Could not connect to one of the clusters:', err.message);
    process.exit(1);
  }

  const sourceDb = sourceClient.db(SOURCE_DB_NAME);
  const targetDb = targetClient.db(TARGET_DB_NAME);

  console.log(`Source: "${SOURCE_DB_NAME}" on the old cluster`);
  console.log(`Target: "${TARGET_DB_NAME}" on the new cluster\n`);

  const collectionNames = Object.values(COLLECTIONS); // employees, equipment, misclogs
  let blocked = false;

  for (const name of collectionNames) {
    const targetCount = await targetDb.collection(name).countDocuments();
    if (targetCount > 0 && !FORCE) {
      console.log(`Refusing to touch "${name}": target already has ${targetCount} document(s). Re-run with --force to overwrite.`);
      blocked = true;
    }
  }
  if (blocked) {
    await sourceClient.close();
    await targetClient.close();
    process.exit(1);
  }

  for (const name of collectionNames) {
    const docs = await sourceDb.collection(name).find({}).toArray();
    if (docs.length === 0) {
      console.log(`"${name}": nothing to migrate (source is empty).`);
      continue;
    }

    if (FORCE) {
      await targetDb.collection(name).deleteMany({});
    }
    await targetDb.collection(name).insertMany(docs);
    console.log(`"${name}": migrated ${docs.length} document(s).`);
  }

  // Recreate the same unique indexes db.js sets up on normal startup, so the
  // migrated data is protected immediately rather than waiting for the next
  // `npm start`.
  try {
    // Partial, not plain, unique - see the matching comment in db.js. Lets
    // any number of not-yet-tagged Microsoft sign-in accounts (no
    // employeeId set) coexist without tripping the uniqueness check.
    await targetDb.collection(COLLECTIONS.EMPLOYEES).createIndex(
      { employeeId: 1 },
      { unique: true, partialFilterExpression: { employeeId: { $type: 'string' } }, name: 'employeeId_1' }
    );
    await targetDb.collection(COLLECTIONS.EMPLOYEES).createIndex({ email: 1 }, { unique: true, sparse: true });
    await targetDb.collection(COLLECTIONS.EQUIPMENT).createIndex({ equipmentId: 1 }, { unique: true });
  } catch (err) {
    console.warn('Could not (re)create unique indexes on the target - check for duplicate IDs:', err.message);
  }

  console.log('\nMigration complete.');

  await sourceClient.close();
  await targetClient.close();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
