const express = require('express');
const { getDb } = require('../db');
const { COLLECTIONS } = require('../constants');

const router = express.Router();

// POST /api/return/complete
// Body: { equipmentIds: string[] }
router.post('/complete', async (req, res) => {
  try {
    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);
    const { equipmentIds = [] } = req.body;
    if (equipmentIds.length === 0) {
      return res.status(400).json({ message: 'Add at least one item to the cart before completing.' });
    }

    // Returning also doubles as "releasing" a Reserved item back to
    // Available - e.g. once the reservation's date has passed, or it falls
    // through. Track which ones were Reserved vs actually borrowed
    // (Unavailable), since only the Reserved ones need their comment
    // (auto-set to the reservation date) cleared out afterward.
    const invalid = [];
    const reservedIds = [];
    const borrowedIds = [];
    for (const equipmentId of equipmentIds) {
      const eq = await equipment.findOne({ equipmentId });
      if (!eq) {
        invalid.push({ equipmentId, reason: 'not_found' });
      } else if (eq.status === 'Reserved') {
        reservedIds.push(equipmentId);
      } else if (eq.status === 'Unavailable') {
        borrowedIds.push(equipmentId);
      } else {
        invalid.push({ equipmentId, reason: 'already_available' });
      }
    }
    if (invalid.length > 0) {
      return res.status(409).json({
        message: 'Some equipment could not be returned. Remove the invalid items and try again.',
        invalid
      });
    }

    // lastBorrowedBy/lastBorrowedAt are intentionally left untouched here -
    // they're history fields that should survive a return.
    if (borrowedIds.length > 0) {
      await equipment.updateMany(
        { equipmentId: { $in: borrowedIds } },
        { $set: { status: 'Available', employeeId: null, purpose: null, event: null } }
      );
    }
    if (reservedIds.length > 0) {
      await equipment.updateMany(
        { equipmentId: { $in: reservedIds } },
        { $set: { status: 'Available', employeeId: null, purpose: null, event: null, comment: '' } }
      );
    }

    res.json({ message: 'Return completed successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while completing the return.', error: err.message });
  }
});

module.exports = router;
