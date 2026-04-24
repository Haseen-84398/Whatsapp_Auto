const { fetchSheetData } = require('./src/sheets');

async function checkHeaders() {
    try {
        const rows = await fetchSheetData();
        if (rows && rows.length > 0) {
            console.log('Headers found in sheet:');
            console.log(rows[0]);
        } else {
            console.log('No rows found or error fetching data.');
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

checkHeaders();
