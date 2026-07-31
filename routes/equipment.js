const express = require('express');
const { getDb } = require('../db');
const {
  COLLECTIONS,
  PURPOSE_OPTIONS,
  ADMIN_EMPLOYEE_ID,
  EQUIPMENT_STATUS_OPTIONS,
  EQUIPMENT_ADMIN_EDITABLE_FIELDS,
  CSV_IMPORT_COLUMNS
} = require('../constants');
const { parseCsv } = require('../utils/csv');

const router = express.Router();

// Gate for the admin-only endpoints below (generic field edit, CSV import).
// Matches the rest of this app's trust model - there's no session/JWT layer
// anywhere, every route trusts whatever employeeId the client sends - so
// this is a consistency check, not a hardened auth boundary.
function requireAdmin(req, res, next) {
  if (req.body.requesterId !== ADMIN_EMPLOYEE_ID) {
    return res.status(403).json({ message: 'Only the Admin account can do this.' });
  }
  next();
}

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

// PATCH /api/equipment/:id/field - Admin-only "edit any cell" endpoint.
// Body: { field, value, requesterId }
// Deliberately separate from the comment/additional-info endpoints above,
// which stay open to every logged-in user.
router.patch('/:id/field', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);
    const employees = db.collection(COLLECTIONS.EMPLOYEES);
    const equipmentId = req.params.id.trim();
    const { field, value } = req.body;

    if (!EQUIPMENT_ADMIN_EDITABLE_FIELDS.includes(field)) {
      return res.status(400).json({ message: `"${field}" is not an editable field.` });
    }

    const existing = await equipment.findOne({ equipmentId });
    if (!existing) {
      return res.status(404).json({ message: `Equipment ID "${equipmentId}" was not found.` });
    }

    const raw = typeof value === 'string' ? value.trim() : value;
    let toStore;

    switch (field) {
      case 'equipmentId': {
        if (!raw) {
          return res.status(400).json({ message: 'Equipment ID cannot be empty.' });
        }
        const clash = await equipment.findOne({ equipmentId: raw, _id: { $ne: existing._id } });
        if (clash) {
          return res.status(409).json({ message: `Equipment ID "${raw}" is already in use.` });
        }
        toStore = raw;
        break;
      }
      case 'item': {
        if (!raw) {
          return res.status(400).json({ message: 'Item cannot be empty.' });
        }
        toStore = raw;
        break;
      }
      case 'status': {
        if (!EQUIPMENT_STATUS_OPTIONS.includes(raw)) {
          return res.status(400).json({ message: `Status must be one of: ${EQUIPMENT_STATUS_OPTIONS.join(', ')}.` });
        }
        toStore = raw;
        break;
      }
      case 'employeeId':
      case 'lastBorrowedBy': {
        if (raw) {
          const emp = await employees.findOne({ employeeId: raw });
          if (!emp) {
            return res.status(400).json({ message: `No employee with ID "${raw}" exists.` });
          }
          toStore = raw;
        } else {
          toStore = null;
        }
        break;
      }
      case 'lastBorrowedAt': {
        if (!raw) {
          toStore = null;
        } else {
          const parsed = new Date(raw);
          if (Number.isNaN(parsed.getTime())) {
            return res.status(400).json({ message: 'Enter a valid date (e.g. 2026-07-30), or leave it blank.' });
          }
          toStore = parsed;
        }
        break;
      }
      case 'event': {
        toStore = raw || '';
        break;
      }
      default: {
        return res.status(400).json({ message: `"${field}" is not an editable field.` });
      }
    }

    const updated = await equipment.findOneAndUpdate(
      { equipmentId },
      { $set: { [field]: toStore } },
      { returnDocument: 'after' }
    );

    res.json({ equipmentId: updated.equipmentId, field, value: updated[field] });
  } catch (err) {
    res.status(500).json({ message: 'Server error while saving that field.', error: err.message });
  }
});

// POST /api/equipment/import - Admin-only CSV import. Body: { csv, requesterId }
// Expects a header row containing (in any order): additionalInfo, comment,
// employeeId, equipmentId, item, status. Upserts by equipmentId - existing
// rows are updated, unrecognized equipmentIds are inserted as new equipment.
router.post('/import', requireAdmin, async (req, res) => {
  try {
    const { csv } = req.body;
    if (typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ message: 'No CSV content was received.' });
    }

    let rows;
    try {
      rows = parseCsv(csv);
    } catch (parseErr) {
      return res.status(400).json({ message: 'Could not parse that CSV file.', error: parseErr.message });
    }

    if (rows.length === 0) {
      return res.status(400).json({ message: 'The CSV file has no data rows.' });
    }

    const headerSet = new Set(Object.keys(rows[0]));
    const missingColumns = CSV_IMPORT_COLUMNS.filter((c) => !headerSet.has(c));
    if (missingColumns.length > 0) {
      return res.status(400).json({
        message: `The CSV is missing required column(s): ${missingColumns.join(', ')}.`
      });
    }

    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);

    let inserted = 0;
    let updated = 0;
    const skipped = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // +1 for header row, +1 for 1-indexing
      const row = rows[i];
      const equipmentId = (row.equipmentId || '').trim();
      const item = (row.item || '').trim();

      if (!equipmentId || !item) {
        skipped.push({ row: rowNum, reason: 'Missing equipmentId or item.' });
        continue;
      }

      let status = (row.status || '').trim();
      if (!EQUIPMENT_STATUS_OPTIONS.includes(status)) {
        status = 'Available';
      }

      const doc = {
        equipmentId,
        item,
        status,
        comment: (row.comment || '').trim(),
        additionalInfo: (row.additionalInfo || '').trim(),
        employeeId: (row.employeeId || '').trim() || null
      };

      const existing = await equipment.findOne({ equipmentId });
      if (existing) {
        await equipment.updateOne({ equipmentId }, { $set: doc });
        updated++;
      } else {
        await equipment.insertOne({
          ...doc,
          purpose: null,
          event: null,
          lastBorrowedBy: null,
          lastBorrowedAt: null
        });
        inserted++;
      }
    }

    res.json({
      message: `Import complete: ${inserted} added, ${updated} updated${skipped.length ? `, ${skipped.length} skipped` : ''}.`,
      inserted,
      updated,
      skipped
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error while importing the CSV.', error: err.message });
  }
});

module.exports = router;
