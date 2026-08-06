const express = require('express');
const { getDb } = require('../db');
const { COLLECTIONS, PURPOSE_OPTIONS, MISC_ITEMS } = require('../constants');
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

    const {
      employeeId,
      purpose,
      event,
      startDate,
      startTime,
      endDate,
      endTime,
      equipmentIds = [],
      miscItems = []
    } = req.body;
    const trimmedEvent = typeof event === 'string' ? event.trim() : '';
    const trimmedStartDate = typeof startDate === 'string' ? startDate.trim() : '';
    const trimmedStartTime = typeof startTime === 'string' ? startTime.trim() : '';
    const trimmedEndDate = typeof endDate === 'string' ? endDate.trim() : '';
    const trimmedEndTime = typeof endTime === 'string' ? endTime.trim() : '';

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
    if (equipmentIds.length > 0 && !PURPOSE_OPTIONS.includes(purpose)) {
      return res.status(400).json({ message: 'Select a valid Purpose before completing the reservation.' });
    }
    if (equipmentIds.length > 0 && !trimmedEvent) {
      return res.status(400).json({ message: 'Enter an Event before completing the reservation.' });
    }
    if (equipmentIds.length > 0 && (!trimmedStartDate || !trimmedStartTime || !trimmedEndDate || !trimmedEndTime)) {
      return res.status(400).json({ message: 'Select a start and end date/time before completing the reservation.' });
    }

    let reservationStart = null;
    let reservationEnd = null;
    let activateNow = false;
    if (equipmentIds.length > 0) {
      reservationStart = new Date(`${trimmedStartDate}T${trimmedStartTime}`);
      reservationEnd = new Date(`${trimmedEndDate}T${trimmedEndTime}`);
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

module.exports = router;
