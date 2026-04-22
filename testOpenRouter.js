const https = require('https');

const OPENROUTER_API_KEY = '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';

const data = JSON.stringify({
    model: 'google/gemini-2.0-flash-001',
    messages: [{ role: 'user', content: 'Hi, say hello in Hindi' }]
});

const options = {
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ceevision.in',
        'X-Title': 'CeeVision WhatsApp Bot'
    }
};

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (d) => (body += d));
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        try {
            const parsed = JSON.parse(body);
            if (parsed.choices && parsed.choices[0]) {
                console.log('✅ AI Response:', parsed.choices[0].message.content);
            } else {
                console.log('Response:', body);
            }
        } catch (e) {
            console.log('Raw:', body);
        }
    });
});

req.on('error', (e) => console.error(e));
req.write(data);
req.end();
