const express = require('express');
const app = require('./server/app');
const dotenv = require('dotenv');

dotenv.config();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`✅ Ujian Pro Server running on port ${PORT}`);
    console.log(`📂 Serving static files from /public`);
});