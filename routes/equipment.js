const express = require('express');
const { getDb } = require('../db');
const { COLLECTIONS, PURPOSE_OPTIONS } = require('../constants');

const router = express.Router();

// GET /api/equipment/meta/purposes - the fixed list of borrow purpose options
router.get('/meta/purposes', (req, res) => {
  res.json(PURPOSE_OPTIONS);
});

// GET /api/equipment - full inventory list, used by the View Inventory tab.
// Enriches each borrowed row with the borrower's display name (looked up
// from the Employees collection) without adding an extra column to the
// Equipment table itself.
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const items = await db.collection(COLLECTIONS.EQUIPMENT).find().sort({ equipmentId: 1 }).toArray();

    const employeeIds = [
      ...new Set(items.flatMap((i) => [i.employeeId, i.lastBorrowedBy]).filter(Boolean))
    ];
    const employees = await db
      .collection(COLLECTIONS.EMPLOYEES)
      .find({ employeeId: { $in: employeeIds } })
      .toArray();
    const nameByEmployeeId = {};
    employees.forEach((e) => {
      nameByEmployeeId[e.employeeId] = e.name;
    });

    const enriched = items.map((i) => ({
      equipmentId: i.equipmentId,
      item: i.item,
      status: i.status,
      comment: i.comment || '',
      additionalInfo: i.additionalInfo || '',
      employeeId: i.employeeId || null,
      employeeName: i.employeeId ? nameByEmployeeId[i.employeeId] || 'Unknown' : null,
      purpose: i.purpose || null,
      event: i.event || null,
      lastBorrowedBy: i.lastBorrowedBy || null,
      lastBorrowedByName: i.lastBorrowedBy ? nameByEmployeeId[i.lastBorrowedBy] || 'Unknown' : null,
      lastBorrowedAt: i.lastBorrowedAt || null
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: 'Server error while loading inventory.', error: err.message });
  }
});

// GET /api/equipment/:id - single lookup, used when adding an item to the
// borrow or return cart so the client can check current status first.
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const equipmentId = req.params.id.trim();
    const item = await db.collection(COLLECTIONS.EQUIPMENT).findOne({ equipmentId });
    if (!item) {
      return res.status(404).json({ message: `Equipment ID "${equipmentId}" was not found.` });
    }

    let employeeName = null;
    if (item.employeeId) {
      const emp = await db.collection(COLLECTIONS.EMPLOYEES).findOne({ employeeId: item.employeeId });
      employeeName = emp ? emp.name : null;
    }

    let lastBorrowedByName = null;
    if (item.lastBorrowedBy) {
      const lastEmp = await db.collection(COLLECTIONS.EMPLOYEES).findOne({ employeeId: item.lastBorrowedBy });
      lastBorrowedByName = lastEmp ? lastEmp.name : null;
    }

    res.json({
      equipmentId: item.equipmentId,
      item: item.item,
      status: item.status,
      comment: item.comment || '',
      additionalInfo: item.additionalInfo || '',
      employeeId: item.employeeId || null,
      employeeName,
      purpose: item.purpose || null,
      event: item.event || null,
      lastBorrowedBy: item.lastBorrowedBy || null,
      lastBorrowedByName,
      lastBorrowedAt: item.lastBorrowedAt || null
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error while looking up equipment.', error: err.message });
  }
});

// PATCH /api/equipment/:id/comment - update just the Comment field. Used by
// the editable Comment column in the View Inventory tab.
router.patch('/:id/comment', async (req, res) => {
  try {
    const db = getDb();
    const equipmentId = req.params.id.trim();
    const { comment } = req.body;

    if (typeof comment !== 'string') {
      return res.status(400).json({ message: 'Comment must be text.' });
    }

    const updated = await db
      .collection(COLLECTIONS.EQUIPMENT)
      .findOneAndUpdate({ equipmentId }, { $set: { comment: comment.trim() } }, { returnDocument: 'after' });

    if (!updated) {
      return res.status(404).json({ message: `Equipment ID "${equipmentId}" was not found.` });
    }

    res.json({ equipmentId: updated.equipmentId, comment: updated.comment });
  } catch (err) {
    res.status(500).json({ message: 'Server error while saving the comment.', error: err.message });
  }
});

// PATCH /api/equipment/:id/additional-info - update just the Additional
// Information field. Used by the editable Additional Information column in
// the View Inventory tab.
router.patch('/:id/additional-info', async (req, res) => {
  try {
    const db = getDb();
    const equipmentId = req.params.id.trim();
    const { additionalInfo } = req.body;

    if (typeof additionalInfo !== 'string') {
      return res.status(400).json({ message: 'Additional Information must be text.' });
    }

    const updated = await db
      .collection(COLLECTIONS.EQUIPMENT)
      .findOneAndUpdate(
        { equipmentId },
        { $set: { additionalInfo: additionalInfo.trim() } },
        { returnDocument: 'after' }
      );

    if (!updated) {
      return res.status(404).json({ message: `Equipment ID "${equipmentId}" was not found.` });
    }

    res.json({ equipmentId: updated.equipmentId, additionalInfo: updated.additionalInfo });
  } catch (err) {
    res.status(500).json({ message: 'Server error while saving the additional information.', error: err.message });
  }
});

module.exports = router;
