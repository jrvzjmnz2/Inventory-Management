const express = require('express');
const { getDb } = require('../db');
const {
  COLLECTIONS,
  PURPOSE_OPTIONS,
  ADMIN_EMPLOYEE_ID,
  EQUIPMENT_STATUS_OPTIONS,
  EQUIPMENT_ADMIN_EDITABLE_FIELDS,
  CSV_IMPORT_COLUMNS,
  CSV_IMPORT_OPTIONAL_COLUMNS
} = require('../constants');
const { parseCsv } = require('../utils/csv');
const {
  canonicalStatus,
  isReservationActive,
  isPendingReservationDue,
  isPendingReservationLapsed
} = require('../utils/status');

// Runs on every equipment read (list + single lookup) so the DB self-heals
// the next time anyone looks at the inventory, rather than needing a cron
// job this app doesn't have. Mutates and returns the same doc so callers can
// build their response off the corrected values immediately. Two things can
// happen here:
//
//  1) An active hold whose end date/time has already passed gets released
//     back to Available.
//  2) A pending (future-start) reservation gets activated once its start
//     date/time arrives - but only if the item happens to be Available right
//     at that moment. If something else has it (borrowed, or another active
//     reservation), activation is simply deferred and re-tried on the next
//     read; if the pending reservation's own end time passes before that
//     ever happens, it's dropped instead since there's nothing left to
//     activate.
async function autoExpireReservation(equipmentCollection, item) {
  if (canonicalStatus(item.status) === 'Reserved' && item.reservedUntil && !isReservationActive(item)) {
    await equipmentCollection.updateOne(
      { equipmentId: item.equipmentId },
      { $set: { status: 'Available', employeeId: null, purpose: null, event: null, reservedUntil: null } }
    );
    item.status = 'Available';
    item.employeeId = null;
    item.purpose = null;
    item.event = null;
    item.reservedUntil = null;
  }

  if (item.pendingReservation) {
    if (isPendingReservationLapsed(item)) {
      await equipmentCollection.updateOne({ equipmentId: item.equipmentId }, { $set: { pendingReservation: null } });
      item.pendingReservation = null;
    } else if (isPendingReservationDue(item) && canonicalStatus(item.status) === 'Available') {
      const pending = item.pendingReservation;
      await equipmentCollection.updateOne(
        { equipmentId: item.equipmentId },
        {
          $set: {
            status: 'Reserved',
            employeeId: pending.employeeId,
            purpose: pending.purpose,
            event: pending.event,
            reservedUntil: pending.end,
            pendingReservation: null
          }
        }
      );
      item.status = 'Reserved';
      item.employeeId = pending.employeeId;
      item.purpose = pending.purpose;
      item.event = pending.event;
      item.reservedUntil = pending.end;
      item.pendingReservation = null;
    }
  }

  return item;
}

const router = express.Router();

// Gate for the admin-only endpoints below (generic field edit, CSV import).
// req.employee is set by the requireSession middleware server.js mounts in
// front of this whole router, so this checks the actual verified session -
// not a client-supplied field, which used to be spoofable by anyone calling
// the API directly.
function requireAdmin(req, res, next) {
  if (!req.employee || req.employee.employeeId !== ADMIN_EMPLOYEE_ID) {
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
    const equipmentCollection = db.collection(COLLECTIONS.EQUIPMENT);
    const items = await equipmentCollection.find().sort({ equipmentId: 1 }).toArray();
    await Promise.all(items.map((i) => autoExpireReservation(equipmentCollection, i)));

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
      // Canonicalize to proper case (Available/Unavailable/Reserved) here,
      // at the source - some existing rows still have status stored in
      // uppercase from before this app's own writes settled on proper case.
      status: canonicalStatus(i.status) || i.status,
      comment: i.comment || '',
      additionalInfo: i.additionalInfo || '',
      ports: i.ports || '',
      location: i.location || '',
      category: i.category || '',
      employeeId: i.employeeId || null,
      employeeName: i.employeeId ? nameByEmployeeId[i.employeeId] || 'Unknown' : null,
      purpose: i.purpose || null,
      event: i.event || null,
      reservedUntil: i.reservedUntil || null,
      borrowUntil: i.borrowUntil || null,
      pendingReservation: i.pendingReservation || null,
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
    const equipmentCollection = db.collection(COLLECTIONS.EQUIPMENT);
    const equipmentId = req.params.id.trim();
    const item = await equipmentCollection.findOne({ equipmentId });
    if (!item) {
      return res.status(404).json({ message: `Equipment ID "${equipmentId}" was not found.` });
    }
    await autoExpireReservation(equipmentCollection, item);

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
      status: canonicalStatus(item.status) || item.status,
      comment: item.comment || '',
      additionalInfo: item.additionalInfo || '',
      ports: item.ports || '',
      location: item.location || '',
      category: item.category || '',
      employeeId: item.employeeId || null,
      employeeName,
      purpose: item.purpose || null,
      event: item.event || null,
      reservedUntil: item.reservedUntil || null,
      borrowUntil: item.borrowUntil || null,
      pendingReservation: item.pendingReservation || null,
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
        const canonical = canonicalStatus(raw);
        if (!canonical) {
          return res.status(400).json({ message: `Status must be one of: ${EQUIPMENT_STATUS_OPTIONS.join(', ')}.` });
        }
        toStore = canonical;
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
      case 'event':
      case 'ports':
      case 'location':
      case 'category': {
        toStore = raw || '';
        break;
      }
      case 'reservedUntil': {
        if (!raw) {
          toStore = null;
        } else {
          const parsed = new Date(raw);
          if (Number.isNaN(parsed.getTime())) {
            return res.status(400).json({ message: 'Enter a valid date/time, or leave it blank.' });
          }
          toStore = parsed;
        }
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
// Requires a header row containing (in any order): additionalInfo, comment,
// employeeId, equipmentId, item, status. Also recognizes optional ports,
// location, and category columns if present - a CSV missing those simply
// imports with those fields blank, so older files still work unchanged. Only
// inserts equipmentIds that aren't already in the inventory - any
// equipmentId that already exists is skipped (left untouched) rather than
// updated, so a re-imported or overlapping CSV can never overwrite current
// inventory data.
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

    // Optional columns are never required, but note which ones this file
    // actually included so the summary message can say so.
    const includedOptionalColumns = CSV_IMPORT_OPTIONAL_COLUMNS.filter((c) => headerSet.has(c));

    const db = getDb();
    const equipment = db.collection(COLLECTIONS.EQUIPMENT);

    let inserted = 0;
    const skipped = [];
    // Tracks equipmentIds this import has already inserted, so a duplicate
    // row later in the same file is also skipped rather than inserted twice.
    const seenInThisImport = new Set();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // +1 for header row, +1 for 1-indexing
      const row = rows[i];
      const equipmentId = (row.equipmentId || '').trim();
      const item = (row.item || '').trim();

      if (!equipmentId || !item) {
        skipped.push({ row: rowNum, reason: 'Missing equipmentId or item.' });
        continue;
      }

      // Only brand-new equipment gets imported - anything already in the
      // inventory (or already inserted earlier in this same CSV) is left
      // untouched rather than updated.
      if (seenInThisImport.has(equipmentId)) {
        skipped.push({ row: rowNum, equipmentId, reason: 'Duplicate equipmentId within this CSV.' });
        continue;
      }
      const existing = await equipment.findOne({ equipmentId });
      if (existing) {
        skipped.push({ row: rowNum, equipmentId, reason: 'Equipment ID already exists in inventory.' });
        continue;
      }

      // Accept any casing (AVAILABLE, available, Available, ...) and store
      // the canonical proper-case value; only truly unrecognized values
      // fall back to Available.
      const status = canonicalStatus(row.status) || 'Available';

      await equipment.insertOne({
        equipmentId,
        item,
        status,
        comment: (row.comment || '').trim(),
        additionalInfo: (row.additionalInfo || '').trim(),
        ports: (row.ports || '').trim(),
        location: (row.location || '').trim(),
        category: (row.category || '').trim(),
        employeeId: (row.employeeId || '').trim() || null,
        purpose: null,
        event: null,
        reservedUntil: null,
        pendingReservation: null,
        lastBorrowedBy: null,
        lastBorrowedAt: null
      });
      seenInThisImport.add(equipmentId);
      inserted++;
    }

    res.json({
      message: `Import complete: ${inserted} added${skipped.length ? `, ${skipped.length} skipped (already in inventory or invalid)` : ''}.${
        includedOptionalColumns.length ? ` Included: ${includedOptionalColumns.join(', ')}.` : ''
      }`,
      inserted,
      skipped
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error while importing the CSV.', error: err.message });
  }
});

module.exports = router;
