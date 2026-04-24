const { fetchSheetData } = require('./src/sheets.js');

async function run() {
    try {
        const rows = await fetchSheetData();
        console.log('Total rows found:', rows.length);
        const headers = rows[0];
        console.log('Headers:', headers);

        const idxBatchId = headers.findIndex((h) => h && h.toString().toLowerCase().includes('batch id'));
        console.log('Batch ID column index:', idxBatchId);

        const batchToFind = '3765695';
        const found = rows.find((r) => r[idxBatchId] && r[idxBatchId].toString().trim() === batchToFind);

        if (found) {
            console.log('✅ Batch found in sheet!', found);
        } else {
            console.log('❌ Batch NOT found in sheet.');
            // Log some batch IDs that ARE there
            console.log(
                'Sample Batch IDs:',
                rows.slice(1, 10).map((r) => r[idxBatchId])
            );
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}
run();
