const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

async function getHeaders() {
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const spreadsheetId = '189cGMDqpEbeXm2DQDvbAuST8YXePwSgnS83-6PpkY-I';

    try {
        // 1. Pehle sheet ki jankari nikalte hain taaki asli naam pata chale
        const metaData = await sheets.spreadsheets.get({
            spreadsheetId
        });

        // 2. Pehli sheet ka title nikalte hain
        const sheetName = metaData.data.sheets[0].properties.title;
        console.log(`Sheet Name mili: "${sheetName}"`);

        // 3. Us sheet ka data padhte hain
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A1:G1` // Asli naam use kar rahe hain
        });
        console.log('Headers:', res.data.values ? res.data.values[0] : 'No data found');
    } catch (error) {
        console.error('Error fetching sheet:', error.message);
    }
}

getHeaders();
