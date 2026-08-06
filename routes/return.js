const express = require('express');
const { getDb } = require('../db');
const { COLLECTIONS } = require('../constants');
const { canonicalStatus, isReservationActive } = require('../utils/status');

const router = express.Router();

// POST /api/return/complete
// Body: { equipmentIds: string[] }
//
// Only equipment that's actually checked out (status Unavailable) can be
// returned here - an item that's merely Reserved (sitting on the shelf,
// never picked up) isn't "returned" in any physical sense, so releasing
// that instead goes through POST /api/reserve/cancel.
//
// If the returned item is still inside an active reservation window
// (reservedUntil in the future - e.g. the reserving employee borrowed it for
// a quick test and is handing it back before the event), it goes back to
// Reserved - not Available - so nobody else can grab it out from under that
// reservation. Only once the hold has actually expired (or there never was
// one) does a return send the item all the way back to Available.
router.post('/complete', async (req, res) => {
  try {
    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);
    const { equipmentIds = [] } = req.body;
    if (equipmentIds.length === 0) {
      return res.status(400).json({ message: 'Add at least one item to the cart before completing.' });
    }

    const invalid = [];
    const backToReservedIds = []; // still inside an active reservation hold
    const fullyReturnedIds = []; // plain borrow, or the hold has expired

    for (const equipmentId of equipmentIds) {
      const eq = await equipment.findOne({ equipmentId });
      if (!eq) {
        invalid.push({ equipmentId, reason: 'not_found' });
      } else if (canonicalStatus(eq.status) !== 'Unavailable') {
        invalid.push({ equipmentId, reason: 'not_checked_out' });
      } else if (isReservationActive(eq)) {
        backToReservedIds.push(equipmentId);
      } else {
        fullyReturnedIds.push(equipmentId);
      }
    }
    if (invalid.length > 0) {
      return res.status(409).json({
        message: 'Some equipment could not be returned. Remove the invalid items and try again.',
        invalid
      });
    }

    // lastBorrowedBy/lastBorrowedAt are intentionally left untouched in both
    // cases - they're history fields that should survive a return.
    if (backToReservedIds.length > 0) {
      await equipment.updateMany({ equipmentId: { $in: backToReservedIds } }, { $set: { status: 'Reserved' } });
    }
    if (fullyReturnedIds.length > 0) {
      await equipment.updateMany(
        { equipmentId: { $in: fullyReturnedIds } },
        { $set: { status: 'Available', employeeId: null, purpose: null, event: null, reservedUntil: null } }
      );
    }

    res.json({ message: 'Return completed successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while completing the return.', error: err.message });
  }
});

module.exports = router;
