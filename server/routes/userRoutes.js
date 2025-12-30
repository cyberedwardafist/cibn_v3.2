const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, verifyRole } = require('../middlewares/authMiddleware');

// Middleware: Semua route di bawah ini butuh login & role 'peserta'
router.use(verifyToken, verifyRole(['peserta']));

router.get('/dashboard', userController.getDashboard);
router.post('/submit_exam', userController.submitExam); // <-- Ini yang penting!

module.exports = router;