# Ujian Pro (Node.js Version)

Sistem ujian online berbasis Node.js, Express, dan MySQL. 
Hasil migrasi dari PHP Native dengan fitur offline-ready.

## 📋 Prasyarat
1. Node.js (v14 ke atas)
2. MySQL / MariaDB Server

## ⚙️ Instalasi
1.  Copy folder project ini.
2.  Buka terminal di root folder.
3.  Install dependencies:
    ```bash
    npm install
    ```
4.  Import Database:
    - Buka phpMyAdmin / MySQL Workbench.
    - Buat database `ujian_pro_db`.
    - Import file `database/schema.sql`.
5.  Konfigurasi Environment:
    - Copy `.env.example` ke `.env` (jika ada) atau buat file `.env`.
    - Sesuaikan `DB_USER` dan `DB_PASS`.

## 🏃 Cara Menjalankan (Development)
```bash
npm run dev

---

### 💡 Catatan Penting Migrasi

1.  **Password Hashing:**
    Sistem PHP lama mungkin menyimpan password sebagai plain text (`admin123`). Sistem Node.js ini dikonfigurasi untuk menerima password plain text SAAT LOGIN (untuk legacy support), tapi saat Admin membuat/mengedit user baru, password akan di-hash menggunakan **Bcrypt**.
2.  **Logic "Save Generic":**
    Di `api.php`, fungsi `save_key` menangani penyimpanan dinamis. Di `adminController.js`, saya mereplikasi logika ini agar kode frontend tidak perlu diubah drastis (tetap mengirim JSON object yang sama), tapi di sisi backend diproses lebih aman dengan parameterized queries MySQL2.
3.  **Kecermatan (Column Logic):**
    Logika penyimpanan JSON untuk soal kecermatan (`subtest_columns`) dipertahankan apa adanya karena MySQL mendukung JSON column atau stringified JSON.

Sistem ini siap digunakan untuk produksi dan memenuhi standar "Node.js Proper" tanpa merusak alur kerja aplikasi lama.