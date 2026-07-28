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

    const invalid = [];
    for (const equipmentId of equipmentIds) {
      const eq = await equipment.findOne({ equipmentId });
      if (!eq) {
        invalid.push({ equipmentId, reason: 'not_found' });
      } else if (eq.status !== 'Unavailable') {
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
    await equipment.updateMany(
      { equipmentId: { $in: equipmentIds } },
      { $set: { status: 'Available', employeeId: null, purpose: null, event: null } }
    );

    res.json({ message: 'Return completed successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while completing the return.', error: err.message });
  }
});

module.exports = router;
