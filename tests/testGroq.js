require('dotenv').config();
const https = require('https');

async function testGroq() {
    console.log('🚀 Testing Groq API (Llama 3)...');
    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.AI_MODEL || 'llama-3.3-70b-versatile';

    const data = JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Hi, say "Groq is working!" in Hinglish.' }]
    });

    const options = {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    };

    const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
            console.log('Status:', res.statusCode);
            try {
                const parsed = JSON.parse(body);
                if (parsed.choices && parsed.choices[0]) {
                    console.log('✅ Groq Response:', parsed.choices[0].message.content);
                } else {
                    console.log('❌ Response:', body);
                }
            } catch (e) {
                console.log('❌ Parse Error:', body);
            }
        });
    });

    req.on('error', (e) => console.error('❌ Request Error:', e.message));
    req.write(data);
    req.end();
}

testGroq();
