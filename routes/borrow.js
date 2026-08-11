const express = require('express');
const { getDb } = require('../db');
const { COLLECTIONS, PURPOSE_OPTIONS, MISC_ITEMS } = require('../constants');
const { canonicalStatus, effectiveStatus, isReservationActive } = require('../utils/status');

const router = express.Router();

// GET /api/borrow/misc-items - the fixed list of miscellaneous options.
router.get('/misc-items', (req, res) => {
  res.json(MISC_ITEMS);
});

// POST /api/borrow/complete
// Body: { employeeId, purpose, event, equipmentIds: string[], miscItems: [{ item, amount }], borrowUntil }
//
// borrowUntil is an optional ISO instant string - the due date/time picked on
// the Borrow tab's "Borrow Until" field. It's optional (rather than required
// here) because this same endpoint is also used by My Items' "Borrow Now"
// bulk-borrow actions, which convert an existing reservation straight into a
// borrow without going through the Borrow tab's form at all. When present,
// it's stored on each borrowed item so My Items can warn the borrower once
// the due date/time is within 12 hours (see borrowDueWarning in the client).
router.post('/complete', async (req, res) => {
  try {
    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);
    const miscLogs = db.collection(COLLECTIONS.MISC_LOGS);

    const { employeeId, purpose, event, equipmentIds = [], miscItems = [], borrowUntil } = req.body;
    const trimmedEvent = typeof event === 'string' ? event.trim() : '';

    let borrowUntilDate = null;
    if (borrowUntil) {
      const parsed = new Date(borrowUntil);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ message: 'Enter a valid Borrow Until date/time.' });
      }
      if (parsed.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'Borrow Until must be a future date/time.' });
      }
      borrowUntilDate = parsed;
    }

    if (!employeeId) {
      return res.status(400).json({ message: 'You must be logged in to borrow equipment.' });
    }
    // Normally employeeId is always the logged-in user (guaranteed to
    // exist). The Admin dashboard can also borrow on behalf of any employee
    // via a free-text ID field, so that value is checked here too.
    const employeeExists = await db.collection(COLLECTIONS.EMPLOYEES).findOne({ employeeId });
    if (!employeeExists) {
      return res.status(400).json({ message: `No employee with ID "${employeeId}" exists.` });
    }
    if (equipmentIds.length === 0 && miscItems.length === 0) {
      return res.status(400).json({ message: 'Add at least one item to the cart before completing.' });
    }
    if (equipmentIds.length > 0 && !PURPOSE_OPTIONS.includes(purpose)) {
      return res.status(400).json({ message: 'Select a valid Purpose before completing the borrow.' });
    }
    if (equipmentIds.length > 0 && !trimmedEvent) {
      return res.status(400).json({ message: 'Enter an Event before completing the borrow.' });
    }

    // Re-check every equipment item right before committing. This guards
    // against another employee borrowing the same item between the moment
    // it was added to this cart and the moment Complete was pressed.
    //
    // Two ways an item is borrowable right now:
    //  - it's plain Available (the normal case), or
    //  - it's Reserved, but the reservation belongs to this same employee
    //    and hasn't expired yet - reserving equipment lets that employee
    //    borrow/return it as many times as they like within the hold
    //    window without releasing the reservation early.
    const conflicts = [];
    for (const equipmentId of equipmentIds) {
      const eq = await equipment.findOne({ equipmentId });
      if (!eq) {
        conflicts.push({ equipmentId, reason: 'not_found' });
        continue;
      }
      const status = effectiveStatus(eq);
      const isMyActiveReservation =
        status === 'Reserved' && eq.employeeId === employeeId && isReservationActive(eq);
      if (status !== 'Available' && !isMyActiveReservation) {
        conflicts.push({ equipmentId, reason: 'unavailable', borrowerId: eq.employeeId });
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
      await equipment.updateMany(
        { equipmentId: { $in: equipmentIds } },
        {
          $set: {
            status: 'Unavailable',
            employeeId,
            purpose,
            event: trimmedEvent,
            lastBorrowedBy: employeeId,
            lastBorrowedAt: new Date(),
            borrowUntil: borrowUntilDate
          }
        }
      );
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

    res.json({ message: 'Borrow completed successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while completing the borrow.', error: err.message });
  }
});

module.exports = router;
