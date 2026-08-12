const { Resend } = require('resend');

const FROM_ADDRESS = process.env.RESEND_FROM
    ? `Renevise HRMS <${process.env.RESEND_FROM}>`
    : 'Renevise HRMS <onboarding@resend.dev>';

async function sendLeaveStatusEmail({ to, employeeName, leaveType, fromDate, untilDate, days, status }) {
    if (!process.env.RESEND_API_KEY) {
        console.warn('[Email] Skipped: RESEND_API_KEY not set');
        return;
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const isApproved = status === 'Approved';
    const statusColor = isApproved ? '#10B981' : '#EF4444';

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f6fb;padding:32px;">
  <div style="background:linear-gradient(135deg,#1F3BFF,#6C4BFF);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:20px;">Leave Request ${status}</h2>
    <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Renevise HRMS &mdash; Automated Notification</p>
  </div>
  <div style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e0e6ff;border-top:none;">
    <p style="color:#222;font-size:15px;margin:0 0 8px;">Dear <strong>${employeeName}</strong>,</p>
    <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px;">
      Your leave request has been reviewed. The decision is:
      <strong style="color:${statusColor};font-size:16px;"> ${status}</strong>
    </p>
    <div style="background:#f9faff;border:1px solid #dde4ff;border-radius:10px;padding:18px 22px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:#444;">
        <tr><td style="padding:6px 0;font-weight:600;color:#111;width:140px;">Leave Type</td><td>${leaveType}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">From</td><td>${fromDate}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Until</td><td>${untilDate}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Total Days</td><td>${days} day${days !== 1 ? 's' : ''}</td></tr>
        <tr>
          <td style="padding:6px 0;font-weight:600;color:#111;">Status</td>
          <td><span style="background:${isApproved ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)'};color:${statusColor};font-weight:700;padding:3px 12px;border-radius:20px;font-size:12px;">${status}</span></td>
        </tr>
      </table>
    </div>
    <p style="color:#666;font-size:13.5px;line-height:1.7;margin:0 0 24px;">
      ${isApproved
        ? 'Your leave has been approved. Please ensure your responsibilities are covered during your absence and coordinate with your team accordingly.'
        : 'Unfortunately, your leave request was not approved this time. Please reach out to your manager for further details or to discuss alternative arrangements.'
      }
    </p>
    <hr style="border:none;border-top:1px solid #eef0ff;margin:0 0 18px;">
    <p style="color:#aaa;font-size:12px;margin:0;">
      This is an automated message from <strong>Renevise HRMS</strong>. Please do not reply to this email.
    </p>
  </div>
</div>`;

    const { data, error } = await resend.emails.send({
        from:    FROM_ADDRESS,
        to,
        subject: `Leave Request ${status} — ${leaveType} (${fromDate} to ${untilDate})`,
        html,
    });

    if (error) {
        console.error('[Email] Leave status email failed:', error.name, '-', error.message, '| statusCode:', error.statusCode);
        throw new Error(error.message);
    }
    console.log('[Email] Leave status email queued. ID:', data?.id);
}

async function sendOtpEmail({ to, employeeName, otp }) {
    if (!process.env.RESEND_API_KEY) {
        console.warn('[Email] Skipped: RESEND_API_KEY not set');
        return;
    }

    console.log('[Email] Sending OTP email via Resend. From:', FROM_ADDRESS, '| To (masked):', to.replace(/(.{3}).*@/, '$1***@'));

    const resend = new Resend(process.env.RESEND_API_KEY);

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f6fb;padding:32px;">
  <div style="background:linear-gradient(135deg,#1F3BFF,#6C4BFF);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:20px;">Password Reset Request</h2>
    <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Renevise HRMS &mdash; Account Security</p>
  </div>
  <div style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e0e6ff;border-top:none;">
    <p style="color:#222;font-size:15px;margin:0 0 8px;">Dear <strong>${employeeName}</strong>,</p>
    <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px;">
      We received a request to reset your password. Use the OTP code below to proceed.
      This code is valid for <strong>10 minutes</strong>.
    </p>
    <div style="background:#f0f4ff;border:2px dashed #3E6BFF;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
      <p style="color:#888;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Your OTP Code</p>
      <span style="font-size:36px;font-weight:700;color:#1F3BFF;letter-spacing:12px;">${otp}</span>
    </div>
    <p style="color:#666;font-size:13.5px;line-height:1.7;margin:0 0 24px;">
      If you did not request a password reset, you can safely ignore this email.
      Your account remains secure and no changes have been made.
    </p>
    <hr style="border:none;border-top:1px solid #eef0ff;margin:0 0 18px;">
    <p style="color:#aaa;font-size:12px;margin:0;">
      This is an automated message from <strong>Renevise HRMS</strong>. Please do not reply to this email.
    </p>
  </div>
</div>`;

    const { data, error } = await resend.emails.send({
        from:    FROM_ADDRESS,
        to,
        subject: 'Your Password Reset OTP — Renevise HRMS',
        html,
    });

    if (error) {
        console.error('[Email] OTP email failed. Name:', error.name, '| Message:', error.message, '| statusCode:', error.statusCode);
        throw new Error(error.message);
    }
    console.log('[Email] OTP email queued successfully. Resend ID:', data?.id);
}

async function sendOvertimeStatusEmail({ to, employeeName, date, extraHours, reason, status }) {
    if (!process.env.RESEND_API_KEY) {
        console.warn('[Email] Skipped: RESEND_API_KEY not set');
        return;
    }

    console.log('[Email] Sending overtime status email. From:', FROM_ADDRESS, '| To (masked):', to.replace(/(.{3}).*@/, '$1***@'));

    const resend      = new Resend(process.env.RESEND_API_KEY);
    const isApproved  = status === 'Approved';
    const statusColor = isApproved ? '#10B981' : '#EF4444';

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f6fb;padding:32px;">
  <div style="background:linear-gradient(135deg,#1F3BFF,#6C4BFF);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:20px;">Overtime Request ${status}</h2>
    <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Renevise HRMS &mdash; Automated Notification</p>
  </div>
  <div style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e0e6ff;border-top:none;">
    <p style="color:#222;font-size:15px;margin:0 0 8px;">Dear <strong>${employeeName}</strong>,</p>
    <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px;">
      Your overtime request has been reviewed. The decision is:
      <strong style="color:${statusColor};font-size:16px;"> ${status}</strong>
    </p>
    <div style="background:#f9faff;border:1px solid #dde4ff;border-radius:10px;padding:18px 22px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:#444;">
        <tr><td style="padding:6px 0;font-weight:600;color:#111;width:160px;">Request Type</td><td>Overtime</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Date</td><td>${date}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Extra Hours</td><td>${extraHours}h</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Reason</td><td>${reason}</td></tr>
        <tr>
          <td style="padding:6px 0;font-weight:600;color:#111;">Status</td>
          <td><span style="background:${isApproved ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)'};color:${statusColor};font-weight:700;padding:3px 12px;border-radius:20px;font-size:12px;">${status}</span></td>
        </tr>
      </table>
    </div>
    <p style="color:#666;font-size:13.5px;line-height:1.7;margin:0 0 24px;">
      ${isApproved
        ? 'Your overtime hours have been approved. They will be accounted for in your records accordingly.'
        : 'Unfortunately, your overtime request was not approved this time. Please reach out to your manager for further details.'
      }
    </p>
    <hr style="border:none;border-top:1px solid #eef0ff;margin:0 0 18px;">
    <p style="color:#aaa;font-size:12px;margin:0;">
      This is an automated message from <strong>Renevise HRMS</strong>. Please do not reply to this email.
    </p>
  </div>
</div>`;

    const { data, error } = await resend.emails.send({
        from   : FROM_ADDRESS,
        to,
        subject: `Overtime Request ${status} — ${date} (${extraHours}h)`,
        html,
    });

    if (error) {
        console.error('[Email] Overtime status email failed:', error.name, '-', error.message, '| statusCode:', error.statusCode);
        throw new Error(error.message);
    }
    console.log('[Email] Overtime status email queued. ID:', data?.id);
}

async function sendCorrectionStatusEmail({ to, employeeName, date, clockIn, clockOut, reason, status }) {
    if (!process.env.RESEND_API_KEY) {
        console.warn('[Email] Skipped: RESEND_API_KEY not set');
        return;
    }

    console.log('[Email] Sending correction status email. From:', FROM_ADDRESS, '| To (masked):', to.replace(/(.{3}).*@/, '$1***@'));

    const resend      = new Resend(process.env.RESEND_API_KEY);
    const isApproved  = status === 'Approved';
    const statusColor = isApproved ? '#10B981' : '#EF4444';

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f6fb;padding:32px;">
  <div style="background:linear-gradient(135deg,#1F3BFF,#6C4BFF);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:20px;">Attendance Correction ${status}</h2>
    <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Renevise HRMS &mdash; Automated Notification</p>
  </div>
  <div style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e0e6ff;border-top:none;">
    <p style="color:#222;font-size:15px;margin:0 0 8px;">Dear <strong>${employeeName}</strong>,</p>
    <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px;">
      Your attendance correction request has been reviewed. The decision is:
      <strong style="color:${statusColor};font-size:16px;"> ${status}</strong>
    </p>
    <div style="background:#f9faff;border:1px solid #dde4ff;border-radius:10px;padding:18px 22px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:#444;">
        <tr><td style="padding:6px 0;font-weight:600;color:#111;width:180px;">Request Type</td><td>Attendance Correction</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Date</td><td>${date}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Requested Clock In</td><td>${clockIn}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Requested Clock Out</td><td>${clockOut}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Reason</td><td>${reason}</td></tr>
        <tr>
          <td style="padding:6px 0;font-weight:600;color:#111;">Status</td>
          <td><span style="background:${isApproved ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)'};color:${statusColor};font-weight:700;padding:3px 12px;border-radius:20px;font-size:12px;">${status}</span></td>
        </tr>
      </table>
    </div>
    <p style="color:#666;font-size:13.5px;line-height:1.7;margin:0 0 24px;">
      ${isApproved
        ? 'Your attendance correction has been approved and your records have been updated accordingly.'
        : 'Unfortunately, your attendance correction request was not approved. Please contact your manager for further clarification.'
      }
    </p>
    <hr style="border:none;border-top:1px solid #eef0ff;margin:0 0 18px;">
    <p style="color:#aaa;font-size:12px;margin:0;">
      This is an automated message from <strong>Renevise HRMS</strong>. Please do not reply to this email.
    </p>
  </div>
</div>`;

    const { data, error } = await resend.emails.send({
        from   : FROM_ADDRESS,
        to,
        subject: `Attendance Correction ${status} — ${date}`,
        html,
    });

    if (error) {
        console.error('[Email] Correction status email failed:', error.name, '-', error.message, '| statusCode:', error.statusCode);
        throw new Error(error.message);
    }
    console.log('[Email] Correction status email queued. ID:', data?.id);
}

async function sendCompanyOffEmail({ to, employeeName, fromDate, untilDate, reason }) {
    if (!process.env.RESEND_API_KEY) {
        console.warn('[Email] Skipped: RESEND_API_KEY not set');
        return;
    }

    const resend      = new Resend(process.env.RESEND_API_KEY);
    const isSingleDay = fromDate === untilDate;

    const dateBlock = isSingleDay
        ? `<tr><td style="padding:6px 0;font-weight:600;color:#111;width:140px;">Date</td><td>${fromDate}</td></tr>`
        : `<tr><td style="padding:6px 0;font-weight:600;color:#111;width:140px;">From</td><td>${fromDate}</td></tr>
           <tr><td style="padding:6px 0;font-weight:600;color:#111;">Until</td><td>${untilDate}</td></tr>`;

    const closedMsg = isSingleDay
        ? `The company will remain closed on <strong>${fromDate}</strong>.`
        : `The company will remain closed from <strong>${fromDate}</strong> to <strong>${untilDate}</strong>.`;

    const subject = isSingleDay
        ? `Company Off — ${fromDate}`
        : `Company Off — ${fromDate} to ${untilDate}`;

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f6fb;padding:32px;">
  <div style="background:linear-gradient(135deg,#1F3BFF,#6C4BFF);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:20px;">Company Off Announced</h2>
    <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Renevise HRMS &mdash; Company Notice</p>
  </div>
  <div style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e0e6ff;border-top:none;">
    <p style="color:#222;font-size:15px;margin:0 0 8px;">Dear <strong>${employeeName}</strong>,</p>
    <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px;">${closedMsg}</p>
    <div style="background:#f9faff;border:1px solid #dde4ff;border-radius:10px;padding:18px 22px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:#444;">
        ${dateBlock}
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Reason</td><td>${reason}</td></tr>
      </table>
    </div>
    <p style="color:#666;font-size:13.5px;line-height:1.7;margin:0 0 24px;">
      The office will be closed during this period. Please plan your work accordingly and ensure
      pending tasks are handled before the off period begins.
    </p>
    <hr style="border:none;border-top:1px solid #eef0ff;margin:0 0 18px;">
    <p style="color:#aaa;font-size:12px;margin:0;">
      This is an automated message from <strong>Renevise HRMS</strong>. Please do not reply to this email.
    </p>
  </div>
</div>`;

    const { data, error } = await resend.emails.send({ from: FROM_ADDRESS, to, subject, html });

    if (error) {
        console.error('[Email] Company off email failed:', error.name, '-', error.message, '| statusCode:', error.statusCode);
        throw new Error(error.message);
    }
    console.log('[Email] Company off email queued. ID:', data?.id);
}

async function sendClientOffStatusEmail({ to, employeeName, date, reason, status }) {
    if (!process.env.RESEND_API_KEY) {
        console.warn('[Email] Skipped: RESEND_API_KEY not set');
        return;
    }

    const resend      = new Resend(process.env.RESEND_API_KEY);
    const isApproved  = status === 'Approved';
    const statusColor = isApproved ? '#10B981' : '#EF4444';

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f4f6fb;padding:32px;">
  <div style="background:linear-gradient(135deg,#EC4899,#BE185D);padding:24px 28px;border-radius:12px 12px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:20px;">Client Off Request ${status}</h2>
    <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:13px;">Renevise HRMS &mdash; Automated Notification</p>
  </div>
  <div style="background:#fff;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #fce7f3;border-top:none;">
    <p style="color:#222;font-size:15px;margin:0 0 8px;">Dear <strong>${employeeName}</strong>,</p>
    <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 24px;">
      Your Client Off request has been reviewed. The decision is:
      <strong style="color:${statusColor};font-size:16px;"> ${status}</strong>
    </p>
    <div style="background:#fdf2f8;border:1px solid #fbcfe8;border-radius:10px;padding:18px 22px;margin-bottom:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:#444;">
        <tr><td style="padding:6px 0;font-weight:600;color:#111;width:140px;">Request Type</td><td>Client Off</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Date</td><td>${date}</td></tr>
        <tr><td style="padding:6px 0;font-weight:600;color:#111;">Reason</td><td>${reason}</td></tr>
        <tr>
          <td style="padding:6px 0;font-weight:600;color:#111;">Status</td>
          <td><span style="background:${isApproved ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)'};color:${statusColor};font-weight:700;padding:3px 12px;border-radius:20px;font-size:12px;">${status}</span></td>
        </tr>
      </table>
    </div>
    <p style="color:#666;font-size:13.5px;line-height:1.7;margin:0 0 24px;">
      ${isApproved
        ? 'Your Client Off request has been approved. This day will be recorded as a client off in your attendance.'
        : 'Unfortunately, your Client Off request was not approved. Please reach out to your manager for further details.'
      }
    </p>
    <hr style="border:none;border-top:1px solid #fce7f3;margin:0 0 18px;">
    <p style="color:#aaa;font-size:12px;margin:0;">
      This is an automated message from <strong>Renevise HRMS</strong>. Please do not reply to this email.
    </p>
  </div>
</div>`;

    const { data, error } = await resend.emails.send({
        from   : FROM_ADDRESS,
        to,
        subject: `Client Off Request ${status} — ${date}`,
        html,
    });

    if (error) {
        console.error('[Email] Client off status email failed:', error.name, '-', error.message, '| statusCode:', error.statusCode);
        throw new Error(error.message);
    }
    console.log('[Email] Client off status email queued. ID:', data?.id);
}

module.exports = { sendLeaveStatusEmail, sendOtpEmail, sendOvertimeStatusEmail, sendCorrectionStatusEmail, sendCompanyOffEmail, sendClientOffStatusEmail };
