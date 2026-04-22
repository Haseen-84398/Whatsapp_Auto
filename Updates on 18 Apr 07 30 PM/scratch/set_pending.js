const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

const SPREADSHEET_ID = '189cGMDqpEbeXm2DQDvbAuST8YXePwSgnS83-6PpkY-I';
const SHEET_NAME = 'Assessment Tracker';

async function getSheetsClient() {
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

async function setPending(rowIndex) {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!F${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [['Pending']]
        }
    });
    console.log(`✅ Row ${rowIndex} status set to Pending.`);
}

setPending(83).catch(console.error);
