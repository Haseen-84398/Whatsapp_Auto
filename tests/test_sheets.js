const { fetchPendingGroups, fetchGroupsNeedingAttendance } = require('../src/sheets');

async function test() {
    console.log('🧪 Test 1: Google Sheets Connection...');
    try {
        const groups = await fetchPendingGroups();
        console.log(`✅ Connection Successful! Found ${groups.length} pending groups.`);
        if (groups.length > 0) {
            console.log('   First group:', groups[0].groupName);
        }
    } catch (err) {
        console.error('❌ fetchPendingGroups FAILED:', err.message);
    }

    console.log('\n🧪 Test 2: Attendance Reminder Check...');
    try {
        const reminders = await fetchGroupsNeedingAttendance();
        console.log(`✅ Success! Found ${reminders.length} groups needing attendance.`);
    } catch (err) {
        console.error('❌ fetchGroupsNeedingAttendance FAILED:', err.message);
    }

    console.log('\n🎉 All tests complete!');
    process.exit(0);
}

test();
