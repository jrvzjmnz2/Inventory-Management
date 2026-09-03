const express = require('express');
const { getDb } = require('../db');
const { COLLECTIONS, EVENT_TYPE_OPTIONS, MISC_ITEMS } = require('../constants');
const {
  canonicalStatus,
  effectiveStatus,
  isReservationActive,
  hasUnexpiredPendingClaim
} = require('../utils/status');

const router = express.Router();

// POST /api/reserve/complete
// Body: { employeeId, purpose, event, startDate, startTime, endDate, endTime,
//          equipmentIds: string[], miscItems: [{ item, amount }] }
//
// Reserving equipment doesn't check it out the way Borrow does - it holds it
// for the reserving employee from the given start date/time until the given
// end date/time. Two different things can happen depending on that start
// time:
//   - If the start is now (or already passed), the hold takes effect right
//     away: status flips to Reserved immediately.
//   - If the start is in the future, the item is left fully Available in the
//     meantime - anyone (including other employees) can borrow or reserve it
//     as normal - and the reservation just sits as a "pending" claim
//     (equipment.pendingReservation) until routes/equipment.js's lazy check
//     activates it once that start time actually arrives (see
//     autoExpireReservation there). If the item is still busy with someone
//     else right when the start time hits, activation is simply deferred and
//     retried on the next read - there's no queueing/priority system.
//
// Once active, that same employee can borrow and return the item as many
// times as they like within the window (see routes/borrow.js and
// routes/return.js) without the hold releasing early - only the dedicated
// Cancel/End Reservation endpoint below, or the end date/time itself
// passing, clears it back to Available.
router.post('/complete', async (req, res) => {
  try {
    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);
    const miscLogs = db.collection(COLLECTIONS.MISC_LOGS);

    const { employeeId, purpose, event, start, end, equipmentIds = [], miscItems = [] } = req.body;
    const trimmedEvent = typeof event === 'string' ? event.trim() : '';

    if (!employeeId) {
      return res.status(400).json({ message: 'You must be logged in to reserve equipment.' });
    }
    // Normally employeeId is always the logged-in user (guaranteed to
    // exist). The Admin dashboard can also reserve on behalf of any employee
    // via a free-text ID field, so that value is checked here too.
    const employeeExists = await db.collection(COLLECTIONS.EMPLOYEES).findOne({ employeeId });
    if (!employeeExists) {
      return res.status(400).json({ message: `No employee with ID "${employeeId}" exists.` });
    }
    if (equipmentIds.length === 0 && miscItems.length === 0) {
      return res.status(400).json({ message: 'Add at least one item to the cart before completing.' });
    }
    if (equipmentIds.length > 0 && !EVENT_TYPE_OPTIONS.includes(purpose)) {
      return res.status(400).json({ message: 'Select a valid Event Type before completing the reservation.' });
    }
    if (equipmentIds.length > 0 && !trimmedEvent) {
      return res.status(400).json({ message: 'Enter an Event Name before completing the reservation.' });
    }
    if (equipmentIds.length > 0 && (!start || !end)) {
      return res.status(400).json({ message: 'Select a start and end date/time before completing the reservation.' });
    }

    let reservationStart = null;
    let reservationEnd = null;
    let activateNow = false;
    if (equipmentIds.length > 0) {
      // start/end are full ISO instant strings (e.g. "2026-08-10T01:00:00.000Z"),
      // built client-side via Date.prototype.toISOString() from whatever the
      // employee actually picked in their own browser's local time - so this
      // parse is unambiguous no matter what timezone this server happens to
      // run in. (Previously this reconstructed the date from separate
      // date/time strings server-side, which new Date() parses as *this
      // server's* local timezone rather than the employee's - if they
      // differed, the stored/displayed time would be shifted by that offset.)
      reservationStart = new Date(start);
      reservationEnd = new Date(end);
      if (Number.isNaN(reservationStart.getTime()) || Number.isNaN(reservationEnd.getTime())) {
        return res.status(400).json({ message: 'Enter a valid start and end date/time.' });
      }
      if (reservationEnd.getTime() <= reservationStart.getTime()) {
        return res.status(400).json({ message: 'The end date/time must be after the start date/time.' });
      }
      if (reservationEnd.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'Choose an end date/time in the future.' });
      }
      activateNow = reservationStart.getTime() <= Date.now();
    }

    // Re-check every equipment item right before committing - guards against
    // another employee borrowing/reserving the same item in the meantime.
    // effectiveStatus() treats a Reserved row whose earlier hold already
    // expired (but hasn't been lazily cleaned up yet) as Available too, and
    // hasUnexpiredPendingClaim() catches an item that's still technically
    // Available but already has someone else's future reservation on it.
    const conflicts = [];
    for (const equipmentId of equipmentIds) {
      const eq = await equipment.findOne({ equipmentId });
      if (!eq) {
        conflicts.push({ equipmentId, reason: 'not_found' });
      } else if (effectiveStatus(eq) !== 'Available') {
        conflicts.push({ equipmentId, reason: 'unavailable', borrowerId: eq.employeeId });
      } else if (hasUnexpiredPendingClaim(eq)) {
        conflicts.push({ equipmentId, reason: 'pending_reservation', borrowerId: eq.pendingReservation.employeeId });
      }
    }
    if (conflicts.length > 0) {
      return res.status(409).json({
        message: 'Some equipment is no longer available. Remove the conflicting items and try again.',
        conflicts
      });
    }

    for (const m of miscItems) {
      if (!MISC_ITEMS.includes(m.item)) {
        return res.status(400).json({ message: `"${m.item}" is not a valid miscellaneous item.` });
      }
      if (!Number.isFinite(m.amount) || m.amount < 1) {
        return res.status(400).json({ message: `Enter a valid amount for ${m.item}.` });
      }
    }

    if (equipmentIds.length > 0) {
      if (activateNow) {
        await equipment.updateMany(
          { equipmentId: { $in: equipmentIds } },
          {
            $set: {
              status: 'Reserved',
              employeeId,
              purpose,
              event: trimmedEvent,
              reservedUntil: reservationEnd,
              pendingReservation: null
            }
          }
        );
      } else {
        await equipment.updateMany(
          { equipmentId: { $in: equipmentIds } },
          {
            $set: {
              pendingReservation: {
                employeeId,
                event: trimmedEvent,
                purpose,
                start: reservationStart,
                end: reservationEnd
              }
            }
          }
        );
      }
    }

    if (miscItems.length > 0) {
      const now = new Date();
      await miscLogs.insertMany(
        miscItems.map((m) => ({
          employeeId,
          item: m.item,
          amount: m.amount,
          exported: false,
          createdAt: now,
          updatedAt: now
        }))
      );
    }

    res.json({
      message: activateNow
        ? 'Reservation completed successfully.'
        : 'Reservation scheduled successfully - the item stays available to everyone until the start time you chose.'
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error while completing the reservation.', error: err.message });
  }
});

// POST /api/reserve/cancel
// Body: { employeeId, equipmentIds: string[] }
//
// Lets the reserving employee (or Admin acting on their behalf, using the
// same on-behalf employeeId already used for Borrow/Reserve) cancel or end
// their own reservation whenever they want, whether it's already active or
// still pending (scheduled for a future start time):
//   - A pending reservation (not yet started) is simply dropped.
//   - An active reservation still sitting on the shelf (status Reserved,
//     never picked up) is fully released back to Available right away.
//   - An active reservation that's currently checked out (status
//     Unavailable), the employee still physically has it, so this only
//     clears the hold (event/reservedUntil) - status stays Unavailable until
//     they actually return it, at which point routes/return.js will send it
//     straight to Available instead of back to Reserved.
router.post('/cancel', async (req, res) => {
  try {
    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);
    const { employeeId, equipmentIds = [] } = req.body;

    if (!employeeId) {
      return res.status(400).json({ message: 'You must be logged in to cancel a reservation.' });
    }
    if (equipmentIds.length === 0) {
      return res.status(400).json({ message: 'Select at least one item to cancel.' });
    }

    const invalid = [];
    const dropPendingIds = []; // future reservation, never activated -> just drop it
    const releaseIds = []; // active, on shelf, never picked up -> fully back to Available
    const endEarlyIds = []; // active, currently checked out -> just clear the hold

    for (const equipmentId of equipmentIds) {
      const eq = await equipment.findOne({ equipmentId });
      if (!eq) {
        invalid.push({ equipmentId, reason: 'not_found' });
      } else if (eq.pendingReservation && eq.pendingReservation.employeeId === employeeId) {
        dropPendingIds.push(equipmentId);
      } else if (eq.employeeId !== employeeId) {
        invalid.push({ equipmentId, reason: 'not_yours' });
      } else if (!isReservationActive(eq)) {
        invalid.push({ equipmentId, reason: 'no_active_reservation' });
      } else if (canonicalStatus(eq.status) === 'Reserved') {
        releaseIds.push(equipmentId);
      } else {
        endEarlyIds.push(equipmentId);
      }
    }

    if (invalid.length > 0) {
      return res.status(409).json({
        message: 'Some items could not be cancelled. Remove the invalid items and try again.',
        invalid
      });
    }

    if (dropPendingIds.length > 0) {
      await equipment.updateMany({ equipmentId: { $in: dropPendingIds } }, { $set: { pendingReservation: null } });
    }
    if (releaseIds.length > 0) {
      await equipment.updateMany(
        { equipmentId: { $in: releaseIds } },
        { $set: { status: 'Available', employeeId: null, purpose: null, event: null, reservedUntil: null } }
      );
    }
    if (endEarlyIds.length > 0) {
      await equipment.updateMany(
        { equipmentId: { $in: endEarlyIds } },
        { $set: { event: null, reservedUntil: null } }
      );
    }

    res.json({ message: 'Reservation cancelled successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while cancelling the reservation.', error: err.message });
  }
});

// POST /api/reserve/reschedule
// Body: { employeeId, equipmentIds: string[], end }
//
// Lets the reserving employee (or Admin acting on their behalf) change how
// long an already-active reservation holds for - used by My Items' "Change
// Reservation Date" bulk action, which only appears once every item under
// one event is still sitting on the shelf (status Reserved, never picked
// up). Only the end date/time can move: once a hold is active its start has
// already happened and isn't stored anywhere separately (only reservedUntil
// is), so there's nothing else left to reschedule.
router.post('/reschedule', async (req, res) => {
  try {
    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);
    const { employeeId, equipmentIds = [], end } = req.body;

    if (!employeeId) {
      return res.status(400).json({ message: 'You must be logged in to change a reservation.' });
    }
    if (equipmentIds.length === 0) {
      return res.status(400).json({ message: 'Select at least one item to reschedule.' });
    }
    if (!end) {
      return res.status(400).json({ message: 'Choose a new reservation end date/time.' });
    }
    // end is a full ISO instant built client-side (same approach as
    // /complete above) so this parse is unambiguous regardless of what
    // timezone this server happens to run in.
    const newEnd = new Date(end);
    if (Number.isNaN(newEnd.getTime())) {
      return res.status(400).json({ message: 'Enter a valid end date/time.' });
    }
    if (newEnd.getTime() <= Date.now()) {
      return res.status(400).json({ message: 'Choose an end date/time in the future.' });
    }

    const invalid = [];
    for (const equipmentId of equipmentIds) {
      const eq = await equipment.findOne({ equipmentId });
      if (!eq) {
        invalid.push({ equipmentId, reason: 'not_found' });
      } else if (eq.employeeId !== employeeId) {
        invalid.push({ equipmentId, reason: 'not_yours' });
      } else if (canonicalStatus(eq.status) !== 'Reserved' || !isReservationActive(eq)) {
        invalid.push({ equipmentId, reason: 'no_active_reservation' });
      }
    }
    if (invalid.length > 0) {
      return res.status(409).json({
        message: 'Some items could not be rescheduled - they may already be borrowed or no longer reserved. Refresh and try again.',
        invalid
      });
    }

    await equipment.updateMany({ equipmentId: { $in: equipmentIds } }, { $set: { reservedUntil: newEnd } });

    res.json({ message: 'Reservation date updated successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while updating the reservation date.', error: err.message });
  }
});

module.exports = router;
