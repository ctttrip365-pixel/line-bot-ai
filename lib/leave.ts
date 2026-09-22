// lib/leave.ts — "Leave_Requests" tab: mid-cycle leave/swap requests from drivers

import { sheetRead, sheetAppendRow, sheetUpdateRow } from './gas-client';
import { log } from './log';

export interface LeaveRequestRow {
  request_id: string;
  driver_id: string;
  dates: string; // comma-separated YYYY-MM-DD
  reason: string;
  requested_at: string;
  status: 'pending' | 'approved' | 'rejected';
  affected_booking_event_id: string;
  resolved_at: string;
}

export async function createLeaveRequest(row: {
  driverId: string;
  dates: string[];
  reason: string;
  affectedBookingEventId?: string;
}): Promise<string> {
  const requestId = `leave_${Date.now()}_${row.driverId}`;
  await sheetAppendRow('Leave_Requests', {
    request_id: requestId,
    driver_id: row.driverId,
    dates: row.dates.join(','),
    reason: row.reason,
    requested_at: new Date().toISOString(),
    status: 'pending',
    affected_booking_event_id: row.affectedBookingEventId ?? '',
    resolved_at: '',
  });
  log.info('leave.requested', { requestId, driverId: row.driverId });
  return requestId;
}

export async function resolveLeaveRequest(
  requestId: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  await sheetUpdateRow('Leave_Requests', 'request_id', requestId, {
    status,
    resolved_at: new Date().toISOString(),
  });
  log.info('leave.resolved', { requestId, status });
}

export async function getLeaveRequest(requestId: string): Promise<LeaveRequestRow | undefined> {
  const res = await sheetRead<LeaveRequestRow[]>('Leave_Requests');
  if (!res.ok || !res.data) {
    log.error('leave.read_failed', { error: res.error });
    return undefined;
  }
  return res.data.find((r) => r.request_id === requestId);
}
