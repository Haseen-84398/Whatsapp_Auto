const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

async function checkSectors() {
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const spreadsheetId = '189cGMDqpEbeXm2DQDvbAuST8YXePwSgnS83-6PpkY-I';

    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'Assessment Tracker'!E2:E`
        });

        const rows = res.data.values;
        if (rows && rows.length) {
            const sectors = new Set();
            rows.forEach((row) => {
                if (row[0] && row[0].trim() !== '') {
                    sectors.add(row[0].trim());
                }
            });
            console.log('Unique Sectors found in Column E:');
            Array.from(sectors).forEach((sector, index) => {
                console.log(`${index + 1}. ${sector}`);
            });
        } else {
            console.log('No data found in Column E.');
        }
    } catch (error) {
        console.error('Error fetching sheet:', error.message);
    }
}

checkSectors();
