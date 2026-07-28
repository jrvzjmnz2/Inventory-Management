const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { COLLECTIONS } = require('../constants');

const router = express.Router();

// Registration is gated by a shared access code so the public-facing login
// link can't be used by strangers to create accounts on their own.
const ACCESS_CODE = process.env.ACCESS_CODE || 'it3mh0und';

// Register a new employee (convenience endpoint so the login page is self-service)
router.post('/register', async (req, res) => {
  try {
    const { employeeId, name, password, accessCode } = req.body;
    if (!employeeId || !name || !password || !accessCode) {
      return res.status(400).json({ message: 'Employee ID, name, password, and access code are required.' });
    }

    if (accessCode !== ACCESS_CODE) {
      return res.status(403).json({ message: 'Invalid access code.' });
    }

    const employees = getDb().collection(COLLECTIONS.EMPLOYEES);

    const existing = await employees.findOne({ employeeId });
    if (existing) {
      return res.status(409).json({ message: 'That Employee ID is already registered.' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const now = new Date();
    await employees.insertOne({ employeeId, name, password: hashed, createdAt: now, updatedAt: now });
    res.status(201).json({ employeeId, name });
  } catch (err) {
    res.status(500).json({ message: 'Server error while registering.', error: err.message });
  }
});

// Log in an employee
router.post('/login', async (req, res) => {
  try {
    const { employeeId, password } = req.body;
    if (!employeeId || !password) {
      return res.status(400).json({ message: 'Employee ID and password are required.' });
    }

    const employees = getDb().collection(COLLECTIONS.EMPLOYEES);
    const employee = await employees.findOne({ employeeId });
    if (!employee) {
      return res.status(401).json({ message: 'Invalid Employee ID or password.' });
    }

    const match = await bcrypt.compare(password, employee.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid Employee ID or password.' });
    }

    res.json({ employeeId: employee.employeeId, name: employee.name });
  } catch (err) {
    res.status(500).json({ message: 'Server error while logging in.', error: err.message });
  }
});

module.exports = router;
