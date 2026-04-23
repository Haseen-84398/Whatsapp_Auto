const { fetchPendingGroups } = require('./src/sheets');

async function testFetch() {
    console.log('Sheet check kar raha hoon...');
    const pending = await fetchPendingGroups();

    if (pending.length === 0) {
        console.log("Sheet mein koi 'Pending' group nahi mila.");
    } else {
        console.log(`Mujhe ${pending.length} groups mile hain jo banane baaki hain:`);
        pending.forEach((g) => {
            console.log(`- Row ${g.rowIndex}: ${g.groupName}`);
        });
    }
}

testFetch();
