require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';
const KNOWLEDGE_BASE_PATH = path.join(__dirname, '..', 'src', 'knowledge_base.json');

function loadKnowledgeBase() {
    const raw = fs.readFileSync(KNOWLEDGE_BASE_PATH, 'utf-8');
    return JSON.parse(raw);
}

function buildSystemPrompt() {
    const kb = loadKnowledgeBase();
    let qaSection = '';
    for (const qa of kb.qa_pairs) {
        qaSection += `\nQ: ${qa.topic} (triggers: ${qa.triggers.join(', ')})\nA: ${qa.answer}\n`;
    }
    return `You are '${kb.bot_name}'. You work ONLY for ${kb.company}.

CRITICAL RULES:
${kb.instructions.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}

If a question is not covered in the knowledge base below, reply EXACTLY:
"${kb.fallback_reply}"

KNOWLEDGE BASE:
${qaSection}

LANGUAGE RULE: Always reply in ${kb.language}. Never use markdown formatting. Keep responses natural and conversational.`;
}

function callAI(userMessage) {
    return new Promise((resolve, reject) => {
        const systemPrompt = buildSystemPrompt();
        const data = JSON.stringify({
            model: AI_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ]
        });
        const options = {
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (d) => body += d);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.choices && parsed.choices[0]) {
                        resolve(parsed.choices[0].message.content);
                    } else {
                        reject(new Error('No AI response: ' + body));
                    }
                } catch (e) {
                    reject(new Error('Parse error: ' + body));
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// === HINDI/HINGLISH TEST CASES ===
async function runHindiTests() {
    const testCases = [
        { label: 'TEST 1: Hindi Greeting', input: 'Namaste bot bhai' },
        { label: 'TEST 2: Hinglish Address', input: 'Files kahan courier karni hain?' },
        { label: 'TEST 3: Hindi Documents', input: 'Assessment ke baad kaunse paper chahiye?' },
        { label: 'TEST 4: Hinglish Evidence', input: 'Photos aur videos ka kya scene hai?' }
    ];

    console.log('🚀 Testing Groq AI with Hindi/Hinglish Input...\n');

    for (const test of testCases) {
        try {
            console.log(`📝 ${test.label}`);
            console.log(`   User (Hindi): "${test.input}"`);
            const reply = await callAI(test.input);
            console.log(`   Bot (English): "${reply}"`);
            console.log('-'.repeat(60));
        } catch (err) {
            console.log(`   ❌ ERROR: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 1000));
    }
}

runHindiTests();
