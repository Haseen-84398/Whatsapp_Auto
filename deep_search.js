const { fetchSheetData } = require('./src/sheets.js');

async function run() {
    try {
        const rows = await fetchSheetData();
        const searchTerm = '3765695';
        let found = false;

        for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < rows[r].length; c++) {
                const cell = rows[r][c];
                if (cell && cell.toString().includes(searchTerm)) {
                    console.log(`✅ Found "${searchTerm}" at Row ${r + 1}, Col ${c + 1}: "${cell}"`);
                    found = true;
                }
            }
        }

        if (!found) {
            console.log(`❌ "${searchTerm}" not found anywhere in the sheet.`);
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}
run();
