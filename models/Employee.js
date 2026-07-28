const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema(
  {
    employeeId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    password: { type: String, required: true }
  },
  { versionKey: false, timestamps: true }
);

module.exports = mongoose.model('Employee', employeeSchema);
