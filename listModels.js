const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = 'AIzaSyB3XvxL0arhgkz0RhO6JMRxsyoI2unPRok';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function listModels() {
    try {
        console.log('🔍 Fetching available models...');
        // Note: The SDK might not have a direct listModels, so we try a common one
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
        const result = await model.generateContent('Hi');
        console.log('✅ gemini-pro is working!');
        console.log('Response:', result.response.text());
    } catch (err) {
        console.error('❌ gemini-pro failed:', err.message);

        try {
            const model2 = genAI.getGenerativeModel({ model: 'gemini-1.0-pro' });
            const result2 = await model2.generateContent('Hi');
            console.log('✅ gemini-1.0-pro is working!');
        } catch (err2) {
            console.error('❌ gemini-1.0-pro failed:', err2.message);
        }
    }
}

listModels();
