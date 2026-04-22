const https = require('https');

const GEMINI_API_KEY = 'AIzaSyB3XvxL0arhgkz0RhO6JMRxsyoI2unPRok';
const data = JSON.stringify({
    contents: [
        {
            parts: [{ text: 'Hi' }]
        }
    ]
});

const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log('Body:', body);
    });
});

req.on('error', (e) => {
    console.error(e);
});

req.write(data);
req.end();
