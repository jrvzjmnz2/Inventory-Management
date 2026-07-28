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

module.exports = { COLLECTIONS, PURPOSE_OPTIONS, MISC_ITEMS };
