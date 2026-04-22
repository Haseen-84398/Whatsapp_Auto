const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

async function checkSpecificRow() {
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const spreadsheetId = '189cGMDqpEbeXm2DQDvbAuST8YXePwSgnS83-6PpkY-I';
    const sheetName = 'Assessment Tracker';

    try {
        // Row 83 means A83:K83
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A83:K83`
        });

        const row = res.data.values ? res.data.values[0] : null;

        if (row) {
            console.log('--- Row 83 Details ---');
            console.log(`Column C (Batch ID): "${row[2] || ''}"`);
            console.log(`Column E (Sector): "${row[4] || ''}"`);
            console.log(`Column F (Status): "${row[5] || ''}"`);
            console.log(`Column K (Date): "${row[10] || ''}"`);
            console.log('-----------------------');
        } else {
            console.log('❌ Row 83 khali hai ya nahi mili.');
        }
    } catch (error) {
        console.error('Error fetching Row 83:', error.message);
    }
}

checkSpecificRow();
