const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Limit besar untuk data soal
app.use(express.urlencoded({ extended: true }));

// Static Files (Frontend)
app.use(express.static(path.join(__dirname, '../public')));

// Routes API
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/user', require('./routes/userRoutes'));
// app.use('/api/exam', require('./routes/examRoutes'));

// Fallback: Serve index.html untuk SPA
// Perbaikan: Gunakan Regex /.*/ alih-alih '*' untuk Express versi baru
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

module.exports = app;