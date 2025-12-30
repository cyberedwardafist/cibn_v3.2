const db = require('../config/database');

// 1. Dashboard Peserta (Load Ujian & History)
exports.getDashboard = async (req, res) => {
    try {
        const uid = req.user.id;
        const gid = req.user.groupId || '';

        // A. Ambil Paket Ujian yang tersedia untuk user/grup ini
        const [rows] = await db.query(`
            SELECT p.id as package_id, p.name as package_name, m.id as module_id, m.name_display, m.name_internal, m.passing_grade
            FROM packages p
            JOIN package_modules pm ON p.id = pm.package_id
            JOIN modules m ON pm.module_id = m.id
            LEFT JOIN package_users pu ON p.id = pu.package_id AND pu.user_id = ?
            WHERE (p.target_type = 'group' AND p.target_id = ?) 
            OR (p.target_type = 'user' AND pu.user_id IS NOT NULL)
            ORDER BY p.id DESC, pm.urutan ASC
        `, [uid, gid]);

        const exams = [];
        const allowedSubIds = new Set();

        for (let row of rows) {
            // Ambil Subtes & Bobot
            const [subs] = await db.query("SELECT subtest_id, percentage FROM module_subtests WHERE module_id=? ORDER BY urutan ASC", [row.module_id]);
            
            const subIds = [];
            const subWeights = [];
            subs.forEach(s => {
                subIds.push(s.subtest_id);
                allowedSubIds.add(s.subtest_id);
                subWeights.push({ id: s.subtest_id, weight: s.percentage });
            });

            exams.push({
                uniqueId: `${row.package_id}_${row.module_id}`,
                packageId: row.package_id,
                packageName: row.package_name,
                module: {
                    id: row.module_id,
                    nameDisplay: row.name_display,
                    nameInternal: row.name_internal,
                    passingGrade: row.passing_grade,
                    subIds: subIds,
                    subWeights: subWeights
                }
            });
        }

        // B. Fetch Subtests Data (Hanya yang diperlukan)
        // Kita perlu data struktur soal untuk frontend
        const fullSubtests = [];
        if (allowedSubIds.size > 0) {
            const idsArray = Array.from(allowedSubIds);
            // Query Subtes Header
            // Tips: Di real production, query detail soal sebaiknya dilakukan saat "Start Exam" per subtes 
            // agar ringan. Tapi untuk meniru PHP load_all, kita load semua disini.
            
            const [subRows] = await db.query(`SELECT * FROM subtests WHERE id IN (?)`, [idsArray]);
            
            for(let s of subRows) {
                // Get Columns (Kecermatan)
                const [cols] = await db.query("SELECT columns_json FROM subtest_columns WHERE subtest_id=?", [s.id]);
                let columnsData = [];
                if(cols.length > 0 && cols[0].columns_json) {
                    const raw = JSON.parse(cols[0].columns_json);
                    columnsData = raw.map((inp, i) => ({id: i+1, inputs: inp}));
                }

                // Get Questions
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
        }

        // C. Riwayat Ujian User (Results)
        const [results] = await db.query("SELECT * FROM results WHERE participant_id = ? ORDER BY end_time DESC LIMIT 200", [uid]);
        const fullResults = [];
        for(let r of results) {
            // Ambil detail subtes result
            const [subRes] = await db.query(`
                SELECT rs.*, s.nav_type, s.type as real_subtype 
                FROM result_subtests rs 
                LEFT JOIN subtests s ON rs.sub_id = s.id 
                WHERE rs.result_id=?`, [r.id]);
            
            const parsedSubs = subRes.map(sr => {
                const jsonDetail = JSON.parse(sr.detail_json || '{}');
                return {
                    subId: sr.sub_id,
                    subName: sr.sub_name,
                    score: parseFloat(sr.score),
                    type: sr.nav_type || jsonDetail.type || 'normal',
                    subType: sr.real_subtype || jsonDetail.subType || 'normal',
                    ...jsonDetail // Spread detail, groupBreakdown, userAnswers, userFlags
                };
            });
            
            fullResults.push({ 
                ...r, 
                endTime: parseInt(r.end_time), // Pastikan integer/timestamp
                totalScore: parseFloat(r.total_score),
                subResults: parsedSubs 
            });
        }
        
        // D. Info Grup User
        const [groups] = await db.query("SELECT * FROM user_groups WHERE id=?", [gid]);

        res.json({
            status: 'success',
            data: {
                exams,
                user: req.user,
                subTests: fullSubtests,
                results: fullResults,
                userGroups: groups
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
};

// 2. Submit Ujian (Simpan Hasil)
exports.submitExam = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const r = req.body.result;
        if (!r) throw new Error("Data hasil ujian kosong");

        const uid = req.user.id;
        const uname = req.user.username;

        // Cek duplikasi ID
        const [check] = await conn.query("SELECT id FROM results WHERE id = ?", [r.id]);
        if (check.length > 0) {
            await conn.rollback();
            return res.json({ status: 'success', message: 'Data sudah ada (skip)' });
        }

        // Hitung Total Skor jika 0 (Fallback safety)
        let totalScore = r.totalScore || 0;
        if (totalScore == 0 && r.subResults && r.subResults.length > 0) {
            const sum = r.subResults.reduce((acc, curr) => acc + curr.score, 0);
            totalScore = sum / r.subResults.length; // Rata-rata sederhana jika tidak ada bobot
        }

        // 1. Insert Header Result
        await conn.execute(
            "INSERT INTO results (id, participant_id, participant_name, module_name, package_id, end_time, total_score) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [r.id, uid, uname, r.moduleName, r.packageId, r.endTime, totalScore]
        );

        // 2. Insert Detail Subtes
        if (r.subResults && Array.isArray(r.subResults)) {
            for (let sub of r.subResults) {
                // Bungkus detail JSON yang kompleks
                const detailData = {
                    type: sub.type,
                    subType: sub.subType,
                    detail: sub.detail,
                    groupBreakdown: sub.groupBreakdown,
                    userAnswers: sub.userAnswers,
                    userFlags: sub.userFlags
                };
                
                await conn.execute(
                    "INSERT INTO result_subtests (result_id, sub_id, sub_name, score, detail_json) VALUES (?, ?, ?, ?, ?)",
                    [r.id, sub.subId, sub.subName, sub.score, JSON.stringify(detailData)]
                );
            }
        }

        await conn.commit();
        res.json({ status: 'success', message: 'Hasil ujian berhasil disimpan' });

    } catch (err) {
        await conn.rollback();
        console.error("Submit Error:", err);
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        conn.release();
    }
};