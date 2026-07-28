const dns = require('dns');
const { MongoClient } = require('mongodb');
const { COLLECTIONS } = require('./constants');

// Some ISPs/routers/VPNs block or fail to resolve the SRV DNS record that
// mongodb+srv:// needs, even though ordinary DNS lookups work fine. Pointing
// Node's own resolver at public DNS servers works around this in most cases,
// without touching any OS-level network settings. This only affects DNS
// lookups made by this Node process - nothing system-wide.
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (err) {
  console.warn('Could not override DNS servers, continuing with system defaults:', err.message);
}

const MONGO_URI = process.env.MONGO_URI;
// Your Atlas database is named "inventory" - set via env var rather than
// baked into the connection string, so it's easy to point at a different
// database (e.g. a test one) without touching MONGO_URI.
const DB_NAME = process.env.MONGO_DB_NAME || 'inventory';

let client;
let db;

async function connectToDatabase() {
  if (db) return db;

  if (!MONGO_URI) {
    throw new Error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
  }

  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);

  // Recreates the uniqueness guarantees the old Mongoose schemas provided.
  // Safe to run every startup - createIndex is a no-op if the index already
  // exists, and only fails if there's already duplicate data to resolve.
  try {
    await db.collection(COLLECTIONS.EMPLOYEES).createIndex({ employeeId: 1 }, { unique: true });
    await db.collection(COLLECTIONS.EQUIPMENT).createIndex({ equipmentId: 1 }, { unique: true });
  } catch (err) {
    console.warn('Could not ensure unique indexes (existing duplicate data?):', err.message);
  }

  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not connected yet - call connectToDatabase() before using getDb().');
  }
  return db;
}

async function closeDatabase() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}

module.exports = { connectToDatabase, getDb, closeDatabase, DB_NAME };
