const { fetchPendingGroups } = require('../src/sheets');

async function check() {
    console.log('🔍 Checking Google Sheet for pending groups...');
    const pending = await fetchPendingGroups();

    if (pending.length === 0) {
        console.log('✅ No pending groups found in the sheet.');
    } else {
        console.log(`📋 Found ${pending.length} pending groups:`);
        pending.forEach((g, i) => {
            console.log(`${i + 1}. [Row ${g.rowIndex}] Name: ${g.groupName}`);
        });
        console.log('\n💡 Aap WhatsApp par !sync likh kar ye groups bana sakte hain.');
    }
}

check().catch(console.error);
