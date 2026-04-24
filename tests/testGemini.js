require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
    console.log('🚀 Testing Direct Gemini API...');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: process.env.AI_MODEL || 'gemini-1.5-flash' });

    try {
        const prompt = "Hi, say 'Namaste! Main working hoon.' in Hinglish.";
        const result = await model.generateContent(prompt);
        const response = await result.response;
        console.log('✅ Gemini Response:', response.text());
    } catch (error) {
        console.error('❌ Gemini Test Failed:', error.message);
    }
}

testGemini();
