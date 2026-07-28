const mongoose = require('mongoose');

// Miscellaneous consumables (tape, cables, etc.) are not tracked equipment,
// so they live in their own log rather than the 5-column Equipment table.
// "exported" tracks whether this entry has already appeared on a Word export,
// so repeated exports don't duplicate old entries.
const miscLogSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, trim: true },
    item: {
      type: String,
      required: true,
      enum: ['Masking Tape', 'Duct Tape', 'Zip Tie', 'Stickers', 'Printer Cable', 'HDMI Cable']
    },
    amount: { type: Number, required: true, min: 1 },
    exported: { type: Boolean, default: false }
  },
  { versionKey: false, timestamps: true }
);

module.exports = mongoose.model('MiscLog', miscLogSchema);
