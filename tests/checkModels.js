require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    try {
        // There isn't a direct listModels in the standard SDK easily accessible this way usually
        // but we can try a simple request with a known good model like 'gemini-pro' or 'gemini-1.5-pro'
        console.log('Checking gemini-1.5-flash...');
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent('Hi');
        console.log('Success with gemini-1.5-flash');
    } catch (e) {
        console.log('Error:', e.message);
    }
}
listModels();
