const https = require('https');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;

https
    .get(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
            console.log(data);
        });
    })
    .on('error', (err) => {
        console.log('Error: ' + err.message);
    });
