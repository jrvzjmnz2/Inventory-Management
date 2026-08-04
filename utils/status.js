const { EQUIPMENT_STATUS_OPTIONS } = require('../constants');

// Some existing inventory rows have their status stored in uppercase
// (AVAILABLE/UNAVAILABLE/RESERVED) from before this app's own borrow/
// return/reserve logic settled on proper case (Available/Unavailable/
// Reserved). This maps either casing to the canonical proper-case value so
// every status comparison in the app (here and on the client) behaves the
// same regardless of how a given row was originally written. Returns null
// if the value doesn't match any known status at all.
function canonicalStatus(status) {
  if (!status) return null;
  const match = EQUIPMENT_STATUS_OPTIONS.find((opt) => opt.toUpperCase() === String(status).toUpperCase());
  return match || null;
}

module.exports = { canonicalStatus };
