require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { connectToDatabase, DB_NAME } = require('./db');

const authRoutes = require('./routes/auth');
const equipmentRoutes = require('./routes/equipment');
const borrowRoutes = require('./routes/borrow');
const reserveRoutes = require('./routes/reserve');
const returnRoutes = require('./routes/return');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Default 100kb JSON body limit is too small once CSV imports (sent as a
// JSON string field) are in play - bumped so a few thousand equipment rows
// comfortably fit.
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/borrow', borrowRoutes);
app.use('/api/reserve', reserveRoutes);
app.use('/api/return', returnRoutes);
app.use('/api/export', exportRoutes);

connectToDatabase()
  .then(() => {
    console.log(`Connected to MongoDB database "${DB_NAME}"`);
    app.listen(PORT, () => {
      console.log(`Inventory Management System running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    console.error('Make sure MONGO_URI (and MONGO_DB_NAME) in .env are correct and reachable.');
    process.exit(1);
  });
