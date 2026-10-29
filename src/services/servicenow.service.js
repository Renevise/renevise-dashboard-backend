const ATTENDANCE_TABLE     = '/api/now/table/x_1785430_innovi_0_attendance_log';
const LEAVE_TABLE          = '/api/now/table/x_1785430_innovi_0_leave';
const OVERTIME_TABLE       = '/api/now/table/x_1785430_innovi_0_overtime_log';
const SYS_USER_TABLE       = '/api/now/table/sys_user';
const CMN_DEPARTMENT_TABLE = '/api/now/table/cmn_department';

function getBase() {
    return process.env.SERVICENOW_INSTANCE_URL;
}

function basicAuthHeader() {
    const u = process.env.SERVICENOW_USERNAME;
    const p = process.env.SERVICENOW_PASSWORD;
    return 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');
}

function msToUtcDatetime(ms) {
    const d   = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    );
}

function toSnowStatus(mongoStatus) {
    switch (mongoStatus) {
        case 'Present':     return 'on_time';
        case 'Late':        return 'late';
        case 'Half Day':    return 'late';
        case 'Early Leave': return 'on_time';
        default:            return 'on_time';
    }
}

async function resolveSnowSysId(email) {
    const url =
        `${getBase()}${SYS_USER_TABLE}` +
        `?sysparm_query=email=${encodeURIComponent(email)}` +
        `&sysparm_fields=sys_id&sysparm_limit=1`;

    const res = await fetch(url, {
        headers: { Authorization: basicAuthHeader(), Accept: 'application/json' },
    });

    if (!res.ok) throw new Error(`sys_user lookup failed (${res.status})`);

    const data = await res.json();
    return data.result?.[0]?.sys_id ?? null;
}

async function resolveSnowDepartmentSysId(departmentName) {
    if (!departmentName) return null;

    const url =
        `${getBase()}${CMN_DEPARTMENT_TABLE}` +
        `?sysparm_query=name=${encodeURIComponent(departmentName)}` +
        `&sysparm_fields=sys_id&sysparm_limit=1`;

    try {
        const res = await fetch(url, {
            headers: { Authorization: basicAuthHeader(), Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.result?.[0]?.sys_id ?? null;
    } catch {
        return null;
    }
}

async function syncEmployeeToSnow({ firstName, lastName, userName, email, department, role }) {
    const base     = getBase();
    const username = process.env.SERVICENOW_USERNAME;
    const password = process.env.SERVICENOW_PASSWORD;

    if (!base || !username || !password) {
        console.warn('[ServiceNow] Skipped: SERVICENOW_* env vars not configured');
        return null;
    }

    const existing = await resolveSnowSysId(email);
    if (existing) {
        console.log('[ServiceNow] sys_user already exists — reusing sys_id');
        return existing;
    }

    const deptSysId = await resolveSnowDepartmentSysId(department);
    if (department && !deptSysId) {
        console.warn(`[ServiceNow] Department "${department}" not found in cmn_department — omitting`);
    }

    const payload = {
        first_name: firstName,
        last_name:  lastName,
        user_name:  userName,
        email,
        active:     'true',
        title:      role,
        ...(deptSysId ? { department: deptSysId } : {}),
    };

    const res = await fetch(`${base}${SYS_USER_TABLE}`, {
        method:  'POST',
        headers: {
            Authorization:  basicAuthHeader(),
            'Content-Type': 'application/json',
            Accept:         'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`ServiceNow sys_user creation failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    const sysId = data.result?.sys_id ?? null;
    console.log(`[ServiceNow] Employee registered — sys_id: ${sysId}`);
    return sysId;
}

async function postAttendanceToSnow({ snowSysId, userEmail, clockInMs, clockOutMs, date, locationType, status, department, breakMinutes, shiftDurationMins }) {
    const base     = getBase();
    const username = process.env.SERVICENOW_USERNAME;
    const password = process.env.SERVICENOW_PASSWORD;

    if (!base || !username || !password) {
        console.warn('[ServiceNow] Skipped: SERVICENOW_* env vars not configured');
        return;
    }

    let sysId = snowSysId ?? null;
    if (!sysId) {
        sysId = await resolveSnowSysId(userEmail);
    }
    if (!sysId) {
        console.warn('[ServiceNow] No sys_user found for employee — sync skipped');
        return;
    }

    const workMode   = locationType === 'remote' ? 'remote' : 'office';
    const isHalfDay  = (status === 'Half Day' || status === 'Early Leave') ? 'true' : 'false';
    const snowStatus = toSnowStatus(status);

    const deptSysId = await resolveSnowDepartmentSysId(department);

    const payload = {
        employee:             sysId,
        log_date:             date,
        clock_in:             msToUtcDatetime(clockInMs),
        clock_out:            msToUtcDatetime(clockOutMs),
        work_mode:            workMode,
        status:               snowStatus,
        is_half_day:          isHalfDay,
        u_break_minutes:      breakMinutes ?? 0,
        shift_duration_mins:  shiftDurationMins ?? 0,
        device_type:          'Desktop',
        source:               'System',
        notes:                'Auto-synced from Renevise HRMS',
        ...(deptSysId ? { department: deptSysId } : {}),
    };

    const res = await fetch(`${base}${ATTENDANCE_TABLE}`, {
        method:  'POST',
        headers: {
            Authorization:  basicAuthHeader(),
            'Content-Type': 'application/json',
            Accept:         'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`ServiceNow POST failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    console.log(`[ServiceNow] Attendance synced — record sys_id: ${data.result?.sys_id}`);
}

function toSnowLeaveType(mongoLeaveType) {
    const t = (mongoLeaveType || '').toLowerCase();
    if (t.includes('sick'))   return 'sick';
    if (t.includes('annual')) return 'annual';
    if (t.includes('casual')) return 'casual';
    if (t.includes('unpaid')) return 'unpaid';
    return 'other';
}

function toSnowLeaveStatus(mongoStatus) {
    switch (mongoStatus) {
        case 'Approved': return 'approved';
        case 'Rejected': return 'rejected';
        default:         return 'pending';
    }
}

async function resolveSnowSysIdByUsername(username) {
    if (!username) return null;
    const url =
        `${getBase()}${SYS_USER_TABLE}` +
        `?sysparm_query=user_name=${encodeURIComponent(username)}` +
        `&sysparm_fields=sys_id&sysparm_limit=1`;
    try {
        const res = await fetch(url, {
            headers: { Authorization: basicAuthHeader(), Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.result?.[0]?.sys_id ?? null;
    } catch {
        return null;
    }
}

async function syncLeaveRequestToSnow({ leave, snowLeaveId }) {
    const base     = getBase();
    const username = process.env.SERVICENOW_USERNAME;
    const password = process.env.SERVICENOW_PASSWORD;

    console.log(`[LeaveSync] ▶ START leave=${leave._id} status="${leave.status}" existingSnowId=${snowLeaveId ?? 'none'}`);

    if (!base || !username || !password) {
        console.warn('[LeaveSync] ✗ Aborted — SERVICENOW_* env vars not configured');
        return null;
    }

    console.log('[LeaveSync] → sys_user lookup for employee');
    let employeeSysId;
    try {
        employeeSysId = await resolveSnowSysId(leave.email);
    } catch (err) {
        console.error(`[LeaveSync] ✗ sys_user lookup threw: ${err.message}`);
        throw err;
    }

    if (!employeeSysId) {
        console.error(
            `[LeaveSync] ✗ No ServiceNow sys_user found for employee. ` +
            `Ensure employee registration triggers syncEmployeeToSnow, or call it before syncLeaveRequestToSnow.`
        );
        return null;
    }
    console.log(`[LeaveSync] ✓ Employee sys_id: ${employeeSysId}`);

    const payload = {
        employee:   employeeSysId,
        leave_type: toSnowLeaveType(leave.leaveType),
        reason:     leave.reason,
        num_days:   leave.days,
        status:     toSnowLeaveStatus(leave.status),
        from_date:  leave.fromDate,
        to_date:    leave.untilDate,
    };

    if (leave.reviewedBy) {
        console.log('[LeaveSync] → approved_by lookup');
        const approvedBySysId = await resolveSnowSysIdByUsername(leave.reviewedBy);
        if (approvedBySysId) {
            payload.approved_by = approvedBySysId;
            console.log(`[LeaveSync] ✓ approved_by sys_id: ${approvedBySysId}`);
        } else {
            console.warn('[LeaveSync] ✗ No sys_user for reviewer — approved_by omitted');
        }
    }

    if (leave.reviewedAt) {
        payload.approved_on = msToUtcDatetime(new Date(leave.reviewedAt).getTime());
    }

    if (snowLeaveId) {
        const url = `${base}${LEAVE_TABLE}/${snowLeaveId}`;
        console.log('[LeaveSync] → PATCH leave record');
        const res = await fetch(url, {
            method: 'PATCH',
            headers: {
                Authorization:  basicAuthHeader(),
                'Content-Type': 'application/json',
                Accept:         'application/json',
            },
            body: JSON.stringify(payload),
        });
        console.log(`[LeaveSync]   HTTP status: ${res.status}`);
        if (!res.ok) {
            const text = await res.text();
            console.error(`[LeaveSync] ✗ PATCH failed — HTTP ${res.status}`);
            throw new Error(`ServiceNow PATCH leave failed (${res.status}): ${text}`);
        }
        const data = await res.json();
        const updatedId = data.result?.sys_id ?? snowLeaveId;
        console.log(`[LeaveSync] ✓ Leave UPDATED in ServiceNow — sys_id: ${updatedId}`);
        return updatedId;
    } else {
        const url = `${base}${LEAVE_TABLE}`;
        console.log('[LeaveSync] → POST leave record');
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization:  basicAuthHeader(),
                'Content-Type': 'application/json',
                Accept:         'application/json',
            },
            body: JSON.stringify(payload),
        });
        console.log(`[LeaveSync]   HTTP status: ${res.status}`);
        if (!res.ok) {
            const text = await res.text();
            console.error(`[LeaveSync] ✗ POST failed — HTTP ${res.status}`);
            throw new Error(`ServiceNow POST leave failed (${res.status}): ${text}`);
        }
        const data = await res.json();
        const newSysId = data.result?.sys_id ?? null;
        console.log(`[LeaveSync] ✓ Leave CREATED in ServiceNow — sys_id: ${newSysId}`);
        return newSysId;
    }
}

async function syncOvertimeToSnow({ overtime, snowOvertimeId }) {
    const base     = getBase();
    const username = process.env.SERVICENOW_USERNAME;
    const password = process.env.SERVICENOW_PASSWORD;

    console.log(`[OvertimeSync] ▶ START overtime=${overtime._id} status="${overtime.status}" existingSnowId=${snowOvertimeId ?? 'none'}`);

    if (!base || !username || !password) {
        console.warn('[OvertimeSync] ✗ Aborted — SERVICENOW_* env vars not configured');
        return null;
    }

    console.log('[OvertimeSync] → sys_user lookup for employee');
    let employeeSysId;
    try {
        employeeSysId = await resolveSnowSysId(overtime.email);
    } catch (err) {
        console.error(`[OvertimeSync] ✗ sys_user lookup threw: ${err.message}`);
        throw err;
    }

    if (!employeeSysId) {
        console.error(
            '[OvertimeSync] ✗ No ServiceNow sys_user found for employee. ' +
            'Ensure the employee is registered in ServiceNow before syncing overtime.'
        );
        return null;
    }
    console.log(`[OvertimeSync] ✓ Employee sys_id: ${employeeSysId}`);

    const payload = {
        employee  : employeeSysId,
        ot_date   : overtime.date,
        ot_hours  : overtime.extraHours,
        status    : overtime.status.toLowerCase(),
    };

    if (overtime.reviewedBy) {
        console.log('[OvertimeSync] → approved_by lookup');
        const reviewedBySysId = await resolveSnowSysIdByUsername(overtime.reviewedBy);
        if (reviewedBySysId) {
            payload.approved_by = reviewedBySysId;
            console.log(`[OvertimeSync] ✓ approved_by sys_id: ${reviewedBySysId}`);
        } else {
            console.warn('[OvertimeSync] ✗ No sys_user for reviewer — approved_by omitted');
        }
    }

    if (snowOvertimeId) {
        const url = `${base}${OVERTIME_TABLE}/${snowOvertimeId}`;
        console.log('[OvertimeSync] → PATCH overtime record');
        const res = await fetch(url, {
            method: 'PATCH',
            headers: {
                Authorization:  basicAuthHeader(),
                'Content-Type': 'application/json',
                Accept:         'application/json',
            },
            body: JSON.stringify(payload),
        });
        console.log(`[OvertimeSync]   HTTP status: ${res.status}`);
        if (!res.ok) {
            const text = await res.text();
            console.error(`[OvertimeSync] ✗ PATCH failed — HTTP ${res.status}`);
            throw new Error(`ServiceNow PATCH overtime failed (${res.status}): ${text}`);
        }
        const data = await res.json();
        const updatedId = data.result?.sys_id ?? snowOvertimeId;
        console.log(`[OvertimeSync] ✓ Overtime UPDATED in ServiceNow — sys_id: ${updatedId}`);
        return updatedId;
    } else {
        const url = `${base}${OVERTIME_TABLE}`;
        console.log('[OvertimeSync] → POST overtime record');
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization:  basicAuthHeader(),
                'Content-Type': 'application/json',
                Accept:         'application/json',
            },
            body: JSON.stringify(payload),
        });
        console.log(`[OvertimeSync]   HTTP status: ${res.status}`);
        if (!res.ok) {
            const text = await res.text();
            console.error(`[OvertimeSync] ✗ POST failed — HTTP ${res.status}`);
            throw new Error(`ServiceNow POST overtime failed (${res.status}): ${text}`);
        }
        const data = await res.json();
        const newSysId = data.result?.sys_id ?? null;
        console.log(`[OvertimeSync] ✓ Overtime CREATED in ServiceNow — sys_id: ${newSysId}`);
        return newSysId;
    }
}

module.exports = { syncEmployeeToSnow, postAttendanceToSnow, syncLeaveRequestToSnow, syncOvertimeToSnow };
