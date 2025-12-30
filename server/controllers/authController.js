const db = require('../config/database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
    try {
        const { user, pass } = req.body;
        // Cari user by username OR email
        const [rows] = await db.execute(
            "SELECT id, username, password, role, group_id, status FROM users WHERE (username=? OR email=?) LIMIT 1",
            [user, user]
        );

        if (rows.length === 0) return res.status(401).json({ status: 'error', message: 'User tidak ditemukan' });

        const userData = rows[0];
        
        // Cek status
        if (userData.status !== 'active') return res.status(401).json({ status: 'error', message: 'Akun dinonaktifkan' });

        // Cek Password (Support Plaintext lama & Bcrypt baru)
        // Note: Project asli pakai plaintext, tapi kita upgrade ke bcrypt
        // Untuk kompatibilitas migrasi, kita cek jika password match langsung (legacy) atau via compare (new)
        let isMatch = (pass === userData.password); 
        if (!isMatch) {
            // Jika hash bcrypt
            isMatch = await bcrypt.compare(pass, userData.password);
        }

        if (!isMatch) return res.status(401).json({ status: 'error', message: 'Password salah' });

        // Generate JWT
        const token = jwt.sign(
            { id: userData.id, username: userData.username, role: userData.role, groupId: userData.group_id },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Update token di DB (untuk kompatibilitas logic lama yg mungkin cek DB)
        await db.execute("UPDATE users SET api_token = ? WHERE id = ?", [token, userData.id]);

        res.json({
            status: 'success',
            data: {
                id: userData.id,
                username: userData.username,
                role: userData.role,
                groupId: userData.group_id,
                status: userData.status,
                token: token
            }
        });

    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
};