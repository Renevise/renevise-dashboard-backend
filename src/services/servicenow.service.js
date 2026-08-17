const ATTENDANCE_TABLE     = '/api/now/table/x_1785430_innovi_0_attendance_log';
const LEAVE_TABLE          = '/api/now/table/x_1785430_innovi_0_leave';
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

// Converts a UTC ms timestamp to "YYYY-MM-DD HH:MM:SS" in UTC.
// ServiceNow treats incoming datetime strings as UTC and applies its own
// timezone internally, so we must send UTC — not PKT — to avoid date drift.
function msToUtcDatetime(ms) {
    const d   = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
        `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    );
}

// Maps MongoDB attendance status to ServiceNow valid choice values.
function toSnowStatus(mongoStatus) {
    switch (mongoStatus) {
        case 'Present':     return 'on_time';
        case 'Late':        return 'late';
        case 'Half Day':    return 'late';
        case 'Early Leave': return 'on_time';
        default:            return 'on_time';
    }
}

// Looks up ServiceNow sys_user.sys_id by email address.
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

// Resolves a cmn_department sys_id by display name.
// Returns null (not throws) so a missing dept never blocks the sync.
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

/**
 * Creates a sys_user in ServiceNow for a newly registered employee.
 * Returns the ServiceNow sys_id, or null if creation failed.
 */
async function syncEmployeeToSnow({ firstName, lastName, userName, email, department, role }) {
    const base     = getBase();
    const username = process.env.SERVICENOW_USERNAME;
    const password = process.env.SERVICENOW_PASSWORD;

    if (!base || !username || !password) {
        console.warn('[ServiceNow] Skipped: SERVICENOW_* env vars not configured');
        return null;
    }

    // Duplicate check — reuse existing sys_id if email already registered
    const existing = await resolveSnowSysId(email);
    if (existing) {
        console.log(`[ServiceNow] sys_user already exists for "${email}" — reusing sys_id`);
        return existing;
    }

    // department is a reference field in sys_user; resolve to sys_id or omit
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

/**
 * Posts a completed attendance record to the ServiceNow attendance_log table.
 * Called fire-and-forget from clockOut — errors are caught by the caller.
 */
async function postAttendanceToSnow({ snowSysId, userEmail, clockInMs, clockOutMs, date, locationType, status, department, breakMinutes, shiftDurationMins }) {
    const base     = getBase();
    const username = process.env.SERVICENOW_USERNAME;
    const password = process.env.SERVICENOW_PASSWORD;

    if (!base || !username || !password) {
        console.warn('[ServiceNow] Skipped: SERVICENOW_* env vars not configured');
        return;
    }

    // Use stored sys_id directly; fall back to email lookup only if not available
    let sysId = snowSysId ?? null;
    if (!sysId) {
        sysId = await resolveSnowSysId(userEmail);
    }
    if (!sysId) {
        console.warn(`[ServiceNow] No sys_user found for email "${userEmail}" — sync skipped`);
        return;
    }

    const workMode   = locationType === 'remote' ? 'remote' : 'office';
    const isHalfDay  = (status === 'Half Day' || status === 'Early Leave') ? 'true' : 'false';
    const snowStatus = toSnowStatus(status);

    // Resolve department to its cmn_department sys_id (reference field)
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

// Maps MongoDB leaveType string to ServiceNow leave_type choice value.
function toSnowLeaveType(mongoLeaveType) {
    const t = (mongoLeaveType || '').toLowerCase();
    if (t.includes('sick'))   return 'sick';
    if (t.includes('annual')) return 'annual';
    if (t.includes('casual')) return 'casual';
    if (t.includes('unpaid')) return 'unpaid';
    return 'other';
}

// Maps MongoDB status to ServiceNow status choice value.
function toSnowLeaveStatus(mongoStatus) {
    switch (mongoStatus) {
        case 'Approved': return 'approved';
        case 'Rejected': return 'rejected';
        default:         return 'pending';
    }
}

// Looks up ServiceNow sys_user.sys_id by username (for reviewedBy field).
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

/**
 * Creates or updates a Leave Request record in ServiceNow.
 * Call fire-and-forget; errors are caught by the caller.
 *
 * @param {object} opts
 * @param {object} opts.leave        - MongoDB Leave document
 * @param {string|null} opts.snowLeaveId - Existing ServiceNow sys_id; null → create, string → update
 * @returns {Promise<string|null>}   ServiceNow sys_id of the created/updated record, or null on failure
 */
async function syncLeaveRequestToSnow({ leave, snowLeaveId }) {
    const base     = getBase();
    const username = process.env.SERVICENOW_USERNAME;
    const password = process.env.SERVICENOW_PASSWORD;

    console.log(`[LeaveSync] ▶ START leave=${leave._id} email="${leave.email}" status="${leave.status}" existingSnowId=${snowLeaveId ?? 'none'}`);

    if (!base || !username || !password) {
        console.warn('[LeaveSync] ✗ Aborted — SERVICENOW_* env vars not configured');
        return null;
    }
    console.log(`[LeaveSync]   SN instance: ${base}`);

    console.log(`[LeaveSync] → sys_user lookup by email: "${leave.email}"`);
    let employeeSysId;
    try {
        employeeSysId = await resolveSnowSysId(leave.email);
    } catch (err) {
        console.error(`[LeaveSync] ✗ sys_user lookup threw: ${err.message}`);
        throw err;
    }

    if (!employeeSysId) {
        console.error(
            `[LeaveSync] ✗ No ServiceNow sys_user found for email "${leave.email}". ` +
            `The employee must exist in ServiceNow before a leave can be synced. ` +
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

    // approved_by — only set when reviewedBy exists (non-pending leaves)
    if (leave.reviewedBy) {
        console.log(`[LeaveSync] → approved_by lookup by username: "${leave.reviewedBy}"`);
        const approvedBySysId = await resolveSnowSysIdByUsername(leave.reviewedBy);
        if (approvedBySysId) {
            payload.approved_by = approvedBySysId;
            console.log(`[LeaveSync] ✓ approved_by sys_id: ${approvedBySysId}`);
        } else {
            console.warn(`[LeaveSync] ✗ No sys_user for username "${leave.reviewedBy}" — approved_by omitted`);
        }
    }

    // approved_on — only set when reviewedAt exists
    if (leave.reviewedAt) {
        payload.approved_on = msToUtcDatetime(new Date(leave.reviewedAt).getTime());
        console.log(`[LeaveSync] ✓ approved_on: ${payload.approved_on}`);
    }

    console.log(`[LeaveSync] → Payload: ${JSON.stringify(payload)}`);

    if (snowLeaveId) {
        // UPDATE existing ServiceNow record
        const url = `${base}${LEAVE_TABLE}/${snowLeaveId}`;
        console.log(`[LeaveSync] → PATCH ${url}`);
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
            console.error(`[LeaveSync] ✗ PATCH failed — response: ${text.slice(0, 500)}`);
            throw new Error(`ServiceNow PATCH leave failed (${res.status}): ${text}`);
        }
        const data = await res.json();
        const updatedId = data.result?.sys_id ?? snowLeaveId;
        console.log(`[LeaveSync] ✓ Leave UPDATED in ServiceNow — sys_id: ${updatedId}`);
        return updatedId;
    } else {
        // CREATE new ServiceNow record
        const url = `${base}${LEAVE_TABLE}`;
        console.log(`[LeaveSync] → POST ${url}`);
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
            console.error(`[LeaveSync] ✗ POST failed — response: ${text.slice(0, 500)}`);
            throw new Error(`ServiceNow POST leave failed (${res.status}): ${text}`);
        }
        const data = await res.json();
        const newSysId = data.result?.sys_id ?? null;
        console.log(`[LeaveSync] ✓ Leave CREATED in ServiceNow — sys_id: ${newSysId}`);
        return newSysId;
    }
}

module.exports = { syncEmployeeToSnow, postAttendanceToSnow, syncLeaveRequestToSnow };
