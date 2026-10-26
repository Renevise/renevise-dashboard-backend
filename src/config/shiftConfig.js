'use strict';

// Grace cutoff — clock-in AFTER this minute = Late
const DEPT_CUTOFF_MINUTES = {
    'ServiceNow':          17 * 60 + 45,  // 5:45 PM PKT
    'AI Content Creation': 17 * 60 + 45,
    'Digital Marketing':   17 * 60 + 45,
    'Web Development':     16 * 60 + 15,  // 4:15 PM PKT
    'App Development':     16 * 60 + 15,
};

// Shift start — minutes from PKT midnight
const DEPT_SHIFT_START_MINUTES = {
    'ServiceNow':          17 * 60 + 30,  // 5:30 PM
    'AI Content Creation': 17 * 60 + 30,
    'Digital Marketing':   17 * 60 + 30,
    'Web Development':     16 * 60,       // 4:00 PM
    'App Development':     16 * 60,
};

// Shift duration in seconds
const DEPT_SHIFT_DURATION_SEC = {
    'ServiceNow':          9 * 3600,  // ends 2:30 AM
    'AI Content Creation': 9 * 3600,
    'Digital Marketing':   9 * 3600,
    'Web Development':     8 * 3600,  // ends midnight
    'App Development':     8 * 3600,
};

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Returns the absolute epoch ms of the scheduled shift end
 * for the employee's clock-in calendar day (PKT).
 */
function getShiftEndMs(clockInMs, department) {
    const dept          = department ?? 'ServiceNow';
    const pktMidnightMs = Math.floor((clockInMs + PKT_OFFSET_MS) / 86400000) * 86400000 - PKT_OFFSET_MS;
    const startMin      = DEPT_SHIFT_START_MINUTES[dept] ?? DEPT_SHIFT_START_MINUTES['ServiceNow'];
    const durSec        = DEPT_SHIFT_DURATION_SEC[dept]  ?? DEPT_SHIFT_DURATION_SEC['ServiceNow'];
    return pktMidnightMs + startMin * 60000 + durSec * 1000;
}

module.exports = { DEPT_CUTOFF_MINUTES, DEPT_SHIFT_START_MINUTES, DEPT_SHIFT_DURATION_SEC, getShiftEndMs };
