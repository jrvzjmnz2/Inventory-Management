const mongoose = require('mongoose');

const PURPOSE_OPTIONS = ['Entractiv', 'Fulfillment', 'Timing', 'Bib Production', 'Office & Admin', 'Kit Claiming'];

// Columns: Equipment ID, Item, Status, Comment, Additional Information,
// Employee ID, Purpose, Event, plus Last Borrowed By/At history fields
const equipmentSchema = new mongoose.Schema(
  {
    equipmentId: { type: String, required: true, unique: true, trim: true },
    item: { type: String, required: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: ['Available', 'Unavailable'],
      default: 'Available'
    },
    comment: { type: String, default: '', trim: true },
    additionalInfo: { type: String, default: '', trim: true },
    employeeId: { type: String, default: null, trim: true },
    purpose: { type: String, enum: [...PURPOSE_OPTIONS, null], default: null },
    event: { type: String, default: null, trim: true },
    // Preserves who last had this item and when, even after it's returned
    // (employeeId/purpose/event get cleared on return, these don't).
    lastBorrowedBy: { type: String, default: null, trim: true },
    lastBorrowedAt: { type: Date, default: null }
  },
  { versionKey: false }
);

equipmentSchema.statics.PURPOSE_OPTIONS = PURPOSE_OPTIONS;

module.exports = mongoose.model('Equipment', equipmentSchema);
