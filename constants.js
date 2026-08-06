// Shared collection names and fixed option lists, used across routes now
// that there's no Mongoose schema layer to define them centrally.

const COLLECTIONS = {
  EMPLOYEES: 'employees',
  EQUIPMENT: 'equipment',
  MISC_LOGS: 'misclogs'
};

const PURPOSE_OPTIONS = ['Entractiv', 'Fulfillment', 'Timing', 'Bib Production', 'Office & Admin', 'Kit Claiming'];

const MISC_ITEMS = [
  'Masking Tape',
  'Duct Tape',
  'Zip Tie',
  'Stickers',
  'Printer Cable',
  'HDMI Cable',
  'DK-2205',
  'Scissors'
];

// The employeeId that unlocks the admin-only interface on the web dashboard
// (full-cell inventory editing, borrowing/reserving on behalf of someone
// else, and CSV import). It's just a regular registered employee account
// with this exact ID - no separate role/permission system.
const ADMIN_EMPLOYEE_ID = 'Admin';

const EQUIPMENT_STATUS_OPTIONS = ['Available', 'Unavailable', 'Reserved'];

// Fields the generic admin "edit any cell" endpoint is allowed to touch.
// Comment/Additional Information are deliberately excluded here - those stay
// on their existing, non-admin-gated endpoints so every user (not just
// Admin) can keep editing them as before.
const EQUIPMENT_ADMIN_EDITABLE_FIELDS = [
  'equipmentId',
  'item',
  'status',
  'employeeId',
  'event',
  'lastBorrowedBy',
  'lastBorrowedAt',
  'reservedUntil',
  'ports',
  'location',
  'category'
];

// Columns required in an admin CSV import - a file missing any of these is
// rejected outright.
const CSV_IMPORT_COLUMNS = ['additionalInfo', 'comment', 'employeeId', 'equipmentId', 'item', 'status'];

// Extra columns an admin CSV import will recognize and store if present, but
// won't reject the file for lacking - older CSV files without them still
// import fine, just leaving these fields blank.
const CSV_IMPORT_OPTIONAL_COLUMNS = ['ports', 'location', 'category'];

module.exports = {
  COLLECTIONS,
  PURPOSE_OPTIONS,
  MISC_ITEMS,
  ADMIN_EMPLOYEE_ID,
  EQUIPMENT_STATUS_OPTIONS,
  EQUIPMENT_ADMIN_EDITABLE_FIELDS,
  CSV_IMPORT_COLUMNS,
  CSV_IMPORT_OPTIONAL_COLUMNS
};
