const express = require('express');
const { getDb } = require('../db');
const { COLLECTIONS, PURPOSE_OPTIONS, MISC_ITEMS } = require('../constants');

const router = express.Router();

// GET /api/borrow/misc-items - the fixed list of miscellaneous options.
router.get('/misc-items', (req, res) => {
  res.json(MISC_ITEMS);
});

// POST /api/borrow/complete
// Body: { employeeId, purpose, event, equipmentIds: string[], miscItems: [{ item, amount }] }
router.post('/complete', async (req, res) => {
  try {
    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);
    const miscLogs = db.collection(COLLECTIONS.MISC_LOGS);

    const { employeeId, purpose, event, equipmentIds = [], miscItems = [] } = req.body;
    const trimmedEvent = typeof event === 'string' ? event.trim() : '';

    if (!employeeId) {
      return res.status(400).json({ message: 'You must be logged in to borrow equipment.' });
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
            status: 'Unavailable',
            employeeId,
            purpose,
            event: trimmedEvent,
            lastBorrowedBy: employeeId,
            lastBorrowedAt: new Date()
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
