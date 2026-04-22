const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = 'AIzaSyB3XvxL0arhgkz0RhO6JMRxsyoI2unPRok';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function testGemini() {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent('Say hello to test if you are working');
        console.log('Success! AI Response:', result.response.text());
    } catch (err) {
        console.error('Error:', err);
    }
}

testGemini();
