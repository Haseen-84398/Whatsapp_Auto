const https = require('https');

const GEMINI_API_KEY = 'AIzaSyB3XvxL0arhgkz0RhO6JMRxsyoI2unPRok';

const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models?key=${GEMINI_API_KEY}`,
    method: 'GET'
};

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        const data = JSON.parse(body);
        if (data.models) {
            console.log('--- Available Models ---');
            data.models.forEach((m) => console.log(m.name));
        } else {
            console.log('No models found:', body);
        }
    });
});

req.on('error', (e) => {
    console.error(e);
});

req.end();
