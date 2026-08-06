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

// True if this equipment doc currently has a reservation hold that hasn't
// reached its end date/time yet. Presence of reservedUntil (rather than the
// raw status value) is what actually marks "this is under an active
// reservation" - status itself flips between Reserved (on the shelf,
// awaiting pickup) and Unavailable (checked out by the reserving employee)
// while reservedUntil/employeeId/event stay put across that cycle.
function isReservationActive(eq) {
  return Boolean(eq && eq.reservedUntil && new Date(eq.reservedUntil).getTime() > Date.now());
}

// Like canonicalStatus, but collapses a stale "Reserved" row whose hold has
// already expired back to "Available" - useful for any read/write path that
// runs between reservation expiries and the next lazy cleanup pass in
// routes/equipment.js (GET /, GET /:id).
//
// Requires reservedUntil to actually be set before doing this - a handful of
// rows may still be "Reserved" from before this field existed (the date used
// to just get stuffed into the comment field). Without a reservedUntil to
// compare against there's no defined end, so those rows keep blocking new
// reservations/borrows exactly like they always have, rather than suddenly
// becoming bookable by anyone.
function effectiveStatus(eq) {
  const canonical = canonicalStatus(eq.status) || eq.status;
  if (canonical === 'Reserved' && eq.reservedUntil && !isReservationActive(eq)) {
    return 'Available';
  }
  return canonical;
}

// A "pending" reservation is one made for a future start time - the item
// stays Available (anyone can borrow/reserve it as normal) right up until
// that start time arrives, at which point routes/equipment.js's lazy check
// activates it into the real Reserved hold (see hasUnexpiredPendingClaim /
// isPendingReservationDue / isPendingReservationLapsed below). It's stored
// as its own object (equipment.pendingReservation) rather than reusing
// employeeId/event/reservedUntil, since those already describe whoever
// currently, actively holds the item - which may be a completely different
// person during the gap before this reservation starts.

// True if there's a pending reservation and its window hasn't fully lapsed
// yet - used to block a second pending reservation from silently
// overwriting the first (since only one is stored at a time).
function hasUnexpiredPendingClaim(eq) {
  return Boolean(eq && eq.pendingReservation && new Date(eq.pendingReservation.end).getTime() > Date.now());
}

// True once a pending reservation's start time has arrived (or passed) -
// meaning it's time to try activating it.
function isPendingReservationDue(eq) {
  return Boolean(eq && eq.pendingReservation && new Date(eq.pendingReservation.start).getTime() <= Date.now());
}

// True once a pending reservation's end time has passed without it ever
// activating (e.g. the item stayed busy with someone else the whole time) -
// there's nothing left to activate, so it should just be dropped.
function isPendingReservationLapsed(eq) {
  return Boolean(eq && eq.pendingReservation && new Date(eq.pendingReservation.end).getTime() <= Date.now());
}

module.exports = {
  canonicalStatus,
  isReservationActive,
  effectiveStatus,
  hasUnexpiredPendingClaim,
  isPendingReservationDue,
  isPendingReservationLapsed
};
