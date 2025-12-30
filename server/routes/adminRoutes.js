const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, verifyRole } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

// --- MIDDLEWARE KEAMANAN ---
// Semua route di bawah ini hanya bisa diakses oleh role 'admin'
router.use(verifyToken, verifyRole(['admin']));

// --- ROUTES ADMIN ---

// 1. Dashboard & Load Data
router.get('/load_all', adminController.loadAllData);

// 2. Manajemen Sub Tes
router.post('/save_subtest', adminController.saveSubtest);
router.post('/delete_subtest', adminController.deleteSubtest); // Penting untuk fitur hapus

// 3. Simpan Data Generic (Akun, Modul, Paket, Grup)
router.post('/save_key', adminController.saveGeneric);

// 4. Upload Gambar
router.post('/upload_image', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ status: 'error', message: 'Tidak ada file yang diupload' });
    }
    // Mengembalikan URL gambar yang bisa diakses frontend
    res.json({ status: 'success', url: `/uploads/${req.file.filename}` });
});

module.exports = router;