const express = require('express');
const { getDb } = require('../db');
const { COLLECTIONS, PURPOSE_OPTIONS, MISC_ITEMS } = require('../constants');

const router = express.Router();

// POST /api/reserve/complete
// Body: { employeeId, purpose, event, date, equipmentIds: string[], miscItems: [{ item, amount }] }
//
// Reserving equipment doesn't check it out the way Borrow does - it just
// marks it as held for a future date/event. The equipment's own "comment"
// field is intentionally overwritten with that date (this replaces whatever
// note was there before, e.g. hardware specs - that's a deliberate trade-off
// requested for this feature). The Return tab is what releases a
// reservation back to Available later (see routes/return.js).
router.post('/complete', async (req, res) => {
  try {
    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);
    const miscLogs = db.collection(COLLECTIONS.MISC_LOGS);

    const { employeeId, purpose, event, date, equipmentIds = [], miscItems = [] } = req.body;
    const trimmedEvent = typeof event === 'string' ? event.trim() : '';
    const trimmedDate = typeof date === 'string' ? date.trim() : '';

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
    if (equipmentIds.length > 0 && !trimmedDate) {
      return res.status(400).json({ message: 'Select a date before completing the reservation.' });
    }

    // Re-check every equipment item right before committing - guards against
    // another employee borrowing/reserving the same item in the meantime.
    const conflicts = [];
    for (const equipmentId of equipmentIds) {
      const eq = await equipment.findOne({ equipmentId });
      if (!eq) {
        conflicts.push({ equipmentId, reason: 'not_found' });
      } else if (eq.status !== 'Available') {
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
            status: 'Reserved',
            employeeId,
            purpose,
            event: trimmedEvent,
            comment: trimmedDate
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

    res.json({ message: 'Reservation completed successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while completing the reservation.', error: err.message });
  }
});

module.exports = router;
