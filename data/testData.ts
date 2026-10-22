// Shared test data for the DMoney regression journey.
//
// A per-run timestamp keeps the Agent's email, phone, and NID unique so
// the suite can be re-run against the live portal without collisions.
const runStamp = Date.now();

export const adminCredentials = {
  email: 'admin@dmoney.com',
  password: '1234',
} as const;

export const systemCredentials = {
  email: 'system@dmoney.com',
  password: '1234',
} as const;

// Gmail "+tag" addressing: every tanjir.exe+...@gmail.com message is
// delivered to the tanjir.exe@gmail.com inbox, so the Gmail token for
// that account can read the Agent's OTP and password-reset emails.
export const agentData = {
  fullName: `Automation Agent ${runStamp}`,
  email: `tanjir.exe+1_${runStamp}@gmail.com`,
  password: 'Agent@1234',

  // 11-digit Bangladeshi mobile format (01XXXXXXXXX).
  phone: `017${String(runStamp).slice(-8)}`,

  // 10-digit national ID.
  nid: String(runStamp).slice(-10),
} as const;

// Password the Agent account is reset to during the flow.
export const resetPassword = 'NewPassword@123';
