require('dotenv').config();
const { MongoClient } = require('mongodb');
const { COLLECTIONS } = require('./constants');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || 'inventory';
const FORCE = process.argv.includes('--force');

async function seed() {
  if (!MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`Connected to database "${DB_NAME}". Seeding sample data...`);

  const employees = db.collection(COLLECTIONS.EMPLOYEES);
  const equipment = db.collection(COLLECTIONS.EQUIPMENT);

  // Safety check: this connects to your real Atlas database, which may
  // already hold real employees/equipment. Refuse to wipe it unless the
  // caller explicitly opts in with --force.
  const existingEmployees = await employees.countDocuments();
  const existingEquipment = await equipment.countDocuments();
  if ((existingEmployees > 0 || existingEquipment > 0) && !FORCE) {
    console.log(
      `Refusing to seed: found ${existingEmployees} existing employee(s) and ` +
        `${existingEquipment} existing equipment record(s) in "${DB_NAME}".\n` +
        'Seeding would delete them. Re-run as "npm run seed -- --force" if you really want to wipe and reseed.'
    );
    await client.close();
    process.exit(1);
  }

  await employees.deleteMany({});
  await equipment.deleteMany({});

  const now = new Date();
  // No passwords - sign-in is Microsoft-only at the AI Hub now, so a
  // hashed password on a seeded employee wouldn't let anyone in. These
  // exist purely so borrow/reserve flows have employeeIds to point at.
  const employeeDocs = [
    { employeeId: 'EMP001', name: 'Juan Dela Cruz', createdAt: now, updatedAt: now },
    { employeeId: 'EMP002', name: 'Maria Santos', createdAt: now, updatedAt: now },
    { employeeId: 'EMP003', name: 'Pedro Reyes', createdAt: now, updatedAt: now }
  ];
  await employees.insertMany(employeeDocs);

  const baseEquipment = { additionalInfo: '', employeeId: null, purpose: null, event: null, lastBorrowedBy: null, lastBorrowedAt: null };
  const equipmentDocs = [
    { equipmentId: 'EQ001', item: 'Dell Latitude Laptop', status: 'Available', comment: 'Core i5, 8GB RAM', ...baseEquipment },
    { equipmentId: 'EQ002', item: 'Dell Latitude Laptop', status: 'Available', comment: 'Core i7, 16GB RAM', ...baseEquipment },
    { equipmentId: 'EQ003', item: 'HP Projector', status: 'Available', comment: 'HDMI + VGA input', ...baseEquipment },
    { equipmentId: 'EQ004', item: 'Wireless Mouse', status: 'Available', comment: '', ...baseEquipment },
    { equipmentId: 'EQ005', item: 'Mechanical Keyboard', status: 'Available', comment: '', ...baseEquipment },
    { equipmentId: 'EQ006', item: 'Portable Monitor', status: 'Available', comment: '15.6 inch', ...baseEquipment },
    { equipmentId: 'EQ007', item: 'Web Camera', status: 'Available', comment: '1080p', ...baseEquipment },
    { equipmentId: 'EQ008', item: 'Conference Speakerphone', status: 'Available', comment: '', ...baseEquipment },
    { equipmentId: 'EQ009', item: 'Ring Light', status: 'Available', comment: '', ...baseEquipment },
    { equipmentId: 'EQ010', item: 'Portable Whiteboard', status: 'Available', comment: 'Small, 2x3 ft', ...baseEquipment }
  ];
  await equipment.insertMany(equipmentDocs);

  console.log('Seeding complete.');
  console.log('Sample employee IDs (sign in with Microsoft at the AI Hub - these are just');
  console.log('records to borrow/reserve against, they are not sign-in accounts):');
  employeeDocs.forEach((e) => console.log(`  Employee ID: ${e.employeeId}  (${e.name})`));

  await client.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
