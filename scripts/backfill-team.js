// One-off backfill: gives every equipment document a `team` field.
//
// Step 2 of the Borrow/Reserve tab groups the whole inventory by
// equipment.team (see TEAM_OPTIONS in constants.js). Documents written
// before that field existed simply don't have it, which is functionally the
// same as blank - they're grouped under "Unassigned" in the picker either
// way. This just makes that explicit, so the field shows up consistently in
// exports, CSV round-trips, and the View Inventory table's Team column
// rather than being absent on older rows and present on newer ones.
//
//   node scripts/backfill-team.js            # set team: '' where missing
//   node scripts/backfill-team.js --team Timing
//                                            # ...and default it to a real
//                                            #    team instead of blank
//
// Existing team values are never overwritten - only documents missing the
// field entirely are touched. Assigning individual items to a team after
// this is done from the View Inventory tab's Team column (Admin only), or
// via a CSV import that includes a `team` column.

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { COLLECTIONS, TEAM_OPTIONS } = require('../constants');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || 'inventory';

// --team <value>: what to put on documents that don't have the field yet.
// Defaults to '' (Unassigned), which is the safe choice - it doesn't claim
// anything about which team owns an item.
function readDefaultTeam() {
  const idx = process.argv.indexOf('--team');
  if (idx === -1) return '';
  const value = (process.argv[idx + 1] || '').trim();
  const match = TEAM_OPTIONS.find((opt) => opt.toLowerCase() === value.toLowerCase());
  if (!match) {
    console.error(`--team must be one of: ${TEAM_OPTIONS.join(', ')}. Leave it off to backfill blank instead.`);
    process.exit(1);
  }
  return match;
}

async function backfill() {
  if (!MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  const defaultTeam = readDefaultTeam();
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  try {
    const equipment = client.db(DB_NAME).collection(COLLECTIONS.EQUIPMENT);
    const missing = await equipment.countDocuments({ team: { $exists: false } });

    if (missing === 0) {
      console.log('Every equipment document already has a team field - nothing to do.');
    } else {
      const result = await equipment.updateMany({ team: { $exists: false } }, { $set: { team: defaultTeam } });
      console.log(
        `Set team: ${defaultTeam ? `"${defaultTeam}"` : "'' (Unassigned)"} on ${result.modifiedCount} document(s).`
      );
    }

    // A quick tally so it's obvious what still needs assigning by hand.
    const counts = {};
    for (const team of await equipment.distinct('team')) {
      counts[team || '(Unassigned)'] = await equipment.countDocuments({ team: team });
    }
    console.log('\nCurrent breakdown by team:');
    Object.entries(counts).forEach(([team, count]) => console.log(`  ${team}: ${count}`));
    console.log('\nAssign items to a team from View Inventory (Admin), or via a CSV import with a team column.');
  } finally {
    await client.close();
  }
}

backfill().catch((err) => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
