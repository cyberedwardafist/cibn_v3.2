const db = require('../config/database');
const bcrypt = require('bcrypt');

// 1. LOAD ALL DATA (Dashboard Admin)
exports.loadAllData = async (req, res) => {
    try {
        const [userGroups] = await db.query("SELECT * FROM user_groups");
        const [accounts] = await db.query("SELECT id, username, email, role, group_id as groupId, status FROM users"); 
        const [modules] = await db.query("SELECT * FROM modules");
        const [subtests] = await db.query("SELECT * FROM subtests");
        const [packages] = await db.query("SELECT * FROM packages");
        const [results] = await db.query("SELECT * FROM results ORDER BY end_time DESC LIMIT 500");

        // Format Modules (Gabungkan dengan detail subtes)
        const formattedModules = [];
        for (let m of modules) {
            const [subs] = await db.query("SELECT subtest_id, percentage FROM module_subtests WHERE module_id=? ORDER BY urutan ASC", [m.id]);
            formattedModules.push({
                ...m,
                nameInternal: m.name_internal,
                nameDisplay: m.name_display,
                passingGrade: m.passing_grade,
                subIds: subs.map(s => s.subtest_id),
                subWeights: subs.map(s => ({ id: s.subtest_id, weight: s.percentage }))
            });
        }
        
        // Format Packages
        const formattedPackages = [];
        for (let p of packages) {
            const [pm] = await db.query("SELECT module_id FROM package_modules WHERE package_id=? ORDER BY urutan ASC", [p.id]);
            const [pu] = await db.query("SELECT user_id FROM package_users WHERE package_id=?", [p.id]);
            formattedPackages.push({
                id: p.id, name: p.name, targetType: p.target_type, targetId: p.target_id,
                moduleIds: pm.map(x => x.module_id),
                selectedUsers: pu.map(x => x.user_id)
            });
        }

        // Format Subtests (Ambil detail soal & kolom)
        const fullSubtests = [];
        for(let s of subtests) {
            const [cols] = await db.query("SELECT columns_json FROM subtest_columns WHERE subtest_id=?", [s.id]);
            let columnsData = cols.length > 0 ? JSON.parse(cols[0].columns_json) : [];
            if(columnsData.length > 0 && !columnsData[0].id) columnsData = columnsData.map((inp, i) => ({id: i+1, inputs: inp}));

            const [qs] = await db.query(
                "SELECT q.*, sq.urutan, sq.group_name FROM subtest_questions sq JOIN questions q ON sq.question_id = q.id WHERE sq.subtest_id = ? ORDER BY sq.urutan ASC", 
                [s.id]
            );
            
            const questions = [];
            for(let q of qs) {
                const [opts] = await db.query("SELECT * FROM options WHERE question_id = ? ORDER BY label ASC", [q.id]);
                questions.push({
                    id: q.id, text: q.text, explanation: q.explanation,
                    columnId: q.column_id, missingChar: q.missing_char, correctLabel: q.correct_label,
                    type: q.column_id ? 'missing_generated' : 'normal',
                    sourceGroupName: q.group_name,
                    options: opts.map(o => ({
                        id: o.id, label: o.label, text: o.text, isCorrect: !!o.is_correct, weight: o.weight
                    }))
                });
            }
            
            fullSubtests.push({
                id: s.id, nameInternal: s.name_internal, nameDisplay: s.name_display,
                duration: s.duration, navType: s.nav_type, type: s.type,
                columnsData, selectedQuestions: questions
            });
        }

        res.json({
            status: 'success',
            data: {
                userGroups, accounts, modules: formattedModules,
                examPackages: formattedPackages, subTests: fullSubtests, results
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
};

// 2. SAVE SUBTEST (Simpan Soal)
exports.saveSubtest = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const data = req.body.data;

        await conn.execute(
            "INSERT INTO subtests (id, name_internal, name_display, duration, nav_type, type) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name_internal=?, name_display=?, duration=?, nav_type=?, type=?",
            [data.id, data.nameInternal, data.nameDisplay, data.duration, data.navType, data.type, data.nameInternal, data.nameDisplay, data.duration, data.navType, data.type]
        );

        await conn.execute("DELETE FROM subtest_questions WHERE subtest_id = ?", [data.id]);

        if (data.selectedQuestions && data.selectedQuestions.length > 0) {
            let urutan = 0;
            for (let q of data.selectedQuestions) {
                urutan++;
                await conn.execute(
                    "INSERT INTO questions (id, text, explanation, column_id, missing_char, correct_label) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE text=?, explanation=?, column_id=?, missing_char=?, correct_label=?",
                    [q.id, q.text, q.explanation, q.columnId || null, q.missingChar || null, q.correctLabel || null, q.text, q.explanation, q.columnId || null, q.missingChar || null, q.correctLabel || null]
                );

                await conn.execute("DELETE FROM options WHERE question_id = ?", [q.id]);
                if(q.options) {
                    for(let opt of q.options) {
                        const oid = opt.id || (Date.now().toString(36) + Math.random().toString(36).substr(2));
                        await conn.execute(
                            "INSERT INTO options (id, question_id, label, text, is_correct, weight) VALUES (?,?,?,?,?,?)",
                            [oid, q.id, opt.label, opt.text, opt.isCorrect ? 1 : 0, opt.weight || 0]
                        );
                    }
                }

                await conn.execute(
                    "INSERT INTO subtest_questions (subtest_id, question_id, urutan, group_name) VALUES (?,?,?,?)",
                    [data.id, q.id, urutan, q.sourceGroupName || '']
                );
            }
        }

        if (data.columnsData) {
            const inputsOnly = data.columnsData.map(c => c.inputs);
            const jsonCols = JSON.stringify(inputsOnly);
            await conn.execute("INSERT INTO subtest_columns (subtest_id, columns_json) VALUES (?,?) ON DUPLICATE KEY UPDATE columns_json=?", [data.id, jsonCols, jsonCols]);
        }

        await conn.commit();
        res.json({ status: 'success' });
    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        conn.release();
    }
};

// 3. SAVE GENERIC (LENGKAP: Akun, Modul, Paket, Grup)
exports.saveGeneric = async (req, res) => {
    const { key, value } = req.body;
    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
        // --- A. SIMPAN AKUN ---
        if (key === 'accounts') {
            const ids = value.map(u => u.id);
            for (let u of value) {
                let finalPass = u.password; 
                // Hash jika password terlihat pendek (belum dihash)
                if(u.password.length < 50) { 
                    finalPass = await bcrypt.hash(u.password, 10);
                }

                await conn.execute(
                    "INSERT INTO users (id, username, email, password, role, group_id, status) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE username=?, email=?, password=?, role=?, group_id=?, status=?",
                    [u.id, u.username, u.email, finalPass, u.role, u.groupId || null, u.status, u.username, u.email, finalPass, u.role, u.groupId || null, u.status]
                );
            }
            if(ids.length > 0) {
                const placeholders = ids.map(() => '?').join(',');
                await conn.query(`DELETE FROM users WHERE id NOT IN (${placeholders}) AND id != 'admin1'`, ids);
            }
        } 
        
        // --- B. SIMPAN MODULES ---
        else if (key === 'modules') {
            const ids = value.map(m => m.id);
            for (let m of value) {
                const passGrade = m.passingGrade || 0;
                await conn.execute(
                    "INSERT INTO modules (id, name_internal, name_display, passing_grade) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name_internal=?, name_display=?, passing_grade=?",
                    [m.id, m.nameInternal, m.nameDisplay, passGrade, m.nameInternal, m.nameDisplay, passGrade]
                );
                
                await conn.execute("DELETE FROM module_subtests WHERE module_id=?", [m.id]);
                const subs = m.subDetails || m.subWeights || [];
                if (Array.isArray(subs)) {
                    let idx = 0;
                    for(let det of subs) {
                         const pct = det.weight || 0;
                         await conn.execute(
                            "INSERT INTO module_subtests (module_id, subtest_id, urutan, percentage) VALUES (?,?,?,?)",
                            [m.id, det.id, idx++, pct]
                         );
                    }
                }
            }
            if (ids.length > 0) {
                 const placeholders = ids.map(() => '?').join(',');
                 await conn.query(`DELETE FROM modules WHERE id NOT IN (${placeholders})`, ids);
            }
        }

        // --- C. SIMPAN PACKAGES (Paket Ujian) ---
        else if (key === 'examPackages') {
            const ids = value.map(p => p.id);
            for (let p of value) {
                const tid = p.targetId || null;
                await conn.execute(
                    "INSERT INTO packages (id, name, target_type, target_id) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE name=?, target_type=?, target_id=?",
                    [p.id, p.name, p.targetType, tid, p.name, p.targetType, tid]
                );

                await conn.execute("DELETE FROM package_modules WHERE package_id=?", [p.id]);
                if (p.moduleIds && Array.isArray(p.moduleIds)) {
                    let idx = 0;
                    for (let mid of p.moduleIds) {
                        await conn.execute("INSERT INTO package_modules (package_id, module_id, urutan) VALUES (?,?,?)", [p.id, mid, idx++]);
                    }
                }

                await conn.execute("DELETE FROM package_users WHERE package_id=?", [p.id]);
                if (p.selectedUsers && Array.isArray(p.selectedUsers)) {
                    for (let uid of p.selectedUsers) {
                        await conn.execute("INSERT INTO package_users (package_id, user_id) VALUES (?,?)", [p.id, uid]);
                    }
                }
            }
            if (ids.length > 0) {
                 const placeholders = ids.map(() => '?').join(',');
                 await conn.query(`DELETE FROM packages WHERE id NOT IN (${placeholders})`, ids);
            }
        }

        // --- D. SIMPAN USER GROUPS ---
        else if (key === 'userGroups') {
            const ids = value.map(g => g.id);
            for (let g of value) {
                 await conn.execute(
                    "INSERT INTO user_groups (id, name) VALUES (?,?) ON DUPLICATE KEY UPDATE name=?",
                    [g.id, g.name, g.name]
                 );
            }
            if (ids.length > 0) {
                 const placeholders = ids.map(() => '?').join(',');
                 await conn.query(`DELETE FROM user_groups WHERE id NOT IN (${placeholders})`, ids);
            }
        }
        
        await conn.commit();
        res.json({ status: 'success' });
    } catch (err) {
        await conn.rollback();
        console.error("Save Key Error:", err);
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        conn.release();
    }
};

// 4. DELETE SUBTEST
exports.deleteSubtest = async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ status: 'error', message: 'ID tidak valid' });

        await db.query("DELETE FROM subtests WHERE id = ?", [id]);
        res.json({ status: 'success' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
};