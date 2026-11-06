import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, CalendarDays, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { apiRequest } from '@/lib/api';
import { karachiMonth } from '@/lib/reports';
import { INBOX_CHANGED, INBOX_SNAPSHOT, getInboxSnapshot, inboxChanged } from '@/lib/module-events';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import MyShift from '@/components/my-shift';
import AttendanceClock from '@/components/attendance-clock';

const titles = { ADMIN: 'Admin overview', HR: 'HR overview', MANAGER: 'Manager overview', EMPLOYEE: 'My overview' };
const roles = { ADMIN: 'Administrator', HR: 'Human Resources', MANAGER: 'Manager', EMPLOYEE: 'Employee' };
const formatted = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
function Go({ to, children }) { return <Link to={to} className="inline-flex items-center gap-1 rounded-lg text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{children}<ArrowUpRight aria-hidden="true" className="size-3.5" /></Link>; }

function useSection(section, month, revision, enabled, onAuthFailure) {
    const [attempt, setAttempt] = useState(0), [result, setResult] = useState(null);
    const key = `${section}:${month}:${revision}:${attempt}`;
    const retry = useCallback(() => setAttempt(v => v + 1), []);
    useEffect(() => {
        if (!enabled) return;
        const ctrl = new AbortController(), query = month ? '?' + new URLSearchParams({ month }) : '';
        void apiRequest(`/dashboard/${section}${query}`, { signal: ctrl.signal }).then(response => { if (!ctrl.signal.aborted) setResult({ key, data: response.data }); }).catch(e => { if (!ctrl.signal.aborted) { setResult({ key, error: e.message }); if (e.status === 401 || e.code === 'PASSWORD_CHANGE_REQUIRED') onAuthFailure(); } });
        return () => ctrl.abort();
    }, [section, month, key, enabled, onAuthFailure]);
    useEffect(() => {
        if (!enabled || section !== 'announcements') return;
        window.addEventListener(INBOX_CHANGED, retry);
        const delays = (result?.key === key ? result.data?.items || [] : []).filter(a => a.expiresAt).map(a => Date.parse(a.expiresAt) - Date.parse(result.data.asOf)).filter(v => v > 0 && Number.isFinite(v));
        const timer = delays.length ? setTimeout(retry, Math.min(...delays, 2147483600) + 50) : null;
        return () => { window.removeEventListener(INBOX_CHANGED, retry); clearTimeout(timer); };
    }, [enabled, section, key, result, retry]);
    return { data: enabled && result?.key === key ? result.data : null, error: enabled && result?.key === key ? result.error : null, loading: enabled && result?.key !== key, retry };
}
function Panel({ title, widget, children, description, controls }) {
    return <section aria-label={title} className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xs sm:p-6"><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="text-lg font-semibold">{title}</h2>{widget?.data?.asOf && <span className="text-xs text-muted-foreground">Checked {formatted(widget.data.asOf)} PKT</span>}</div>{description && <p className="text-sm text-muted-foreground">{description}</p>}{controls}{widget?.loading ? <p role="status">Loading {title.toLowerCase()}...</p> : widget?.error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{title} unavailable: {widget.error}</p><Button variant="outline" onClick={widget.retry}>Retry {title.toLowerCase()}</Button></div> : children}</section>;
}
function Metrics({ items }) { return <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{items.map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border bg-background/60 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 text-xl font-semibold tabular-nums">{value == null ? <span className="text-sm font-normal">Unavailable</span> : value}</dd></div>)}</dl>; }
const subscribeInbox = callback => { window.addEventListener(INBOX_SNAPSHOT, callback); return () => window.removeEventListener(INBOX_SNAPSHOT, callback); };
function InboxSummary({ user }) {
    const snapshot = useSyncExternalStore(subscribeInbox, () => getInboxSnapshot(user.id));
    const ready = snapshot?.ownerId === user.id && snapshot.state === 'ready';
    return <Panel title="My notifications" description="Your private inbox shares the header bell's existing refresh."><p aria-label="My unread notification count" className="text-3xl font-semibold">{ready ? snapshot.unreadCount : snapshot?.state === 'loading' ? 'Loading...' : 'Unavailable'}</p>{ready && <p className="text-xs text-muted-foreground">Unread · checked {formatted(snapshot.asOf)} PKT</p>}<Go to="/notifications">Open my inbox</Go>{!ready && snapshot?.state !== 'loading' && <Button variant="outline" onClick={inboxChanged}>Refresh notification summary</Button>}</Panel>;
}
function RecentAnnouncements({ widget }) {
    const rows = widget.data?.items || [], important = rows.filter(a => a.pinned || ['IMPORTANT', 'HIGH', 'URGENT'].includes(a.priority)), other = rows.filter(a => !important.includes(a));
    const item = a => <article key={a.id} className="min-w-0 space-y-2 rounded-xl border p-3"><h3 className="break-words font-medium">{a.pinned ? 'Pinned · ' : ''}{a.title}</h3><p className="text-xs text-muted-foreground">{a.category} · {a.priority} · Published {formatted(a.publishedAt)} PKT</p><Go to={a.link}>View announcement</Go></article>;
    return <Panel title="Recent announcements" widget={widget} description="Published to your frozen recipient audience. Loading this summary does not mark anything read.">{!rows.length ? <p className="text-sm">No active announcements published to you.</p> : <div className="space-y-3">{important.length > 0 && <div role="region" aria-label="Important announcements" className="space-y-3">{important.map(item)}</div>}{other.map(item)}</div>}<Go to="/announcements">Open my announcement feed</Go></Panel>;
}

export default function DashboardPage() { const { user } = useAuth(); return <Dashboard key={`${user.id}:${user.role}`} user={user} />; }
function Dashboard({ user }) {
    const { refreshSession } = useAuth();
    const [revision, setRevision] = useState(0), [payrollMonth, setPayrollMonth] = useState(karachiMonth);
    const authFailed = useRef(false);
    const onAuthFailure = useCallback(() => { if (!authFailed.current) { authFailed.current = true; void refreshSession(); } }, [refreshSession]);
    const manage = ['ADMIN', 'HR'].includes(user.role), team = user.role === 'MANAGER';
    const employees = useSection('employees', '', revision, manage || team, onAuthFailure);
    const attendance = useSection('attendance', '', revision, true, onAuthFailure);
    const queues = useSection('queues', payrollMonth, revision, manage, onAuthFailure);
    const personal = useSection('personal', '', revision, true, onAuthFailure);
    const payslip = useSection('payslip', '', revision, true, onAuthFailure);
    const announcements = useSection('announcements', '', revision, true, onAuthFailure);
    const pending = [employees, attendance, queues, personal, payslip, announcements].some(w => w.loading);
    const emp = employees.data, att = attendance.data, q = queues.data, my = personal.data, slip = payslip.data;
    const payrollLink = status => '/payroll?' + new URLSearchParams({ month: q?.payrollMonth || payrollMonth, status });
    const leaveQueue = '/leaves?view=management&status=PENDING&allMonths=true';
    return <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-primary">{roles[user.role]}</p><h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{titles[user.role]}</h1><p className="mt-2 text-sm text-muted-foreground">Welcome back, {user.displayName}. Your daily OfficeHR starting point.</p></div><Button variant="outline" disabled={pending} onClick={() => { setRevision(v => v + 1); inboxChanged(); }}><RefreshCw aria-hidden="true" className="size-4" />Refresh dashboard</Button></div>
        <p className="flex items-start gap-2 rounded-xl border bg-card p-3 text-sm text-muted-foreground"><CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Asia/Karachi. Attendance follows its duty start date; payroll and leave use their own labeled calendar months. Summaries do not change payroll or attendance.</p>
        {manage && <Panel title={user.role === 'ADMIN' ? 'Admin work queues' : 'HR work queues'} widget={queues} controls={<label className="block max-w-xs text-sm">Payroll summary month<Input type="month" aria-label="Payroll summary month" value={payrollMonth} onChange={e => setPayrollMonth(e.target.value)} /></label>} description="Attendance corrections and leave queues cover all dates/months. Payroll uses the selected month.">{q && <><Metrics items={user.role === 'ADMIN' ? [
            ['Pending attendance corrections', q.pendingCorrections], ['HR-approved payroll total', q.hrApprovedPayroll], ['Eligible for my final approval', q.eligibleFinalApprovals], ['Awaiting manual payment', q.awaitingManualPayment], ['Pending leave (oversight)', q.pendingLeavesOverall],
        ] : [['Pending attendance corrections', q.pendingCorrections], ['Draft payroll for HR review', q.draftPayroll], ['Awaiting manual payment', q.awaitingManualPayment], ['Leave I can review', q.reviewableLeaves], ['Pending leave overall', q.pendingLeavesOverall]]} /><p className="text-sm">Payroll month: {q.payrollMonth}. Payments are recorded manually; OfficeHR does not transfer funds.</p>{user.role === 'ADMIN' && <p className="text-xs text-muted-foreground">Blocked by same-approver rule: {q.blockedSameApprover}; stale/missing applicable salary: {q.blockedStaleSalary}; revision limit: {q.blockedRevisionLimit}. Blockers can overlap. Payroll rechecks eligibility.</p>}<div className="flex flex-wrap gap-4"><Go to="/attendance?view=corrections">Open pending attendance corrections</Go>{user.role === 'ADMIN' ? <Go to={payrollLink('HR_APPROVED')}>Open HR-approved payroll (including blocked records)</Go> : <Go to={payrollLink('DRAFT')}>Open draft payroll for HR review</Go>}<Go to={payrollLink('APPROVED')}>Open approved payroll awaiting payment</Go><Go to={leaveQueue + (user.role === 'HR' ? '&reviewableOnly=true' : '')}>{user.role === 'HR' ? 'Open leave I can review' : 'Open read-only leave oversight'}</Go></div></>}</Panel>}
        <div className="grid items-start gap-6 xl:grid-cols-2">
            {(manage || team) && <Panel title={team ? 'My assigned team employees' : 'Employee overview'} widget={employees} description="Employment uses dated episodes and status history, not login account status.">{emp && <><p className="text-sm">As of {emp.date} PKT · {team ? 'Assigned teams only' : 'Organization profiles'}</p>{team && <p className="text-sm">Assigned team intervals: {emp.assignedTeams}. {emp.assignedTeams === 0 ? 'No team assignment is effective for this date.' : ''}</p>}<Metrics items={[[team ? 'Team profiles' : 'Employee profiles', emp.totalProfiles], ['Eligible employment', emp.eligibleEmployment], ['Active employment', emp.statuses.ACTIVE], ['Probation', emp.statuses.PROBATION], ['Notice period', emp.statuses.NOTICE_PERIOD], ['Suspended', emp.statuses.SUSPENDED], ['Exited / ended', emp.statuses.EXITED], ['Future start', emp.statuses.FUTURE_START], ['No employment history', emp.statuses.NO_EMPLOYMENT], ['Unresolved status', emp.statuses.UNKNOWN]]} /><p className="text-xs text-muted-foreground">Eligible = active + probation + notice period. Ended latest episodes count as exited; future/no employment and unresolved states are separate.</p><Go to={team ? '/my-employees' : '/employees'}>{team ? 'Open my employee workspace' : 'Open employee list'}</Go></>}</Panel>}
            <Panel title={manage ? 'Organization duty attendance' : team ? 'Team and own duty attendance' : 'My duty attendance'} widget={attendance}>{att && <>{att.state === 'PROFILE_LINK_REQUIRED' ? <p className="text-sm">No employee profile is linked. Contact Admin/HR to view personal attendance.</p> : <><p className="text-sm">Duty start date: {att.dutyDate} · Asia/Karachi · 19:00 to 05:00 next day.</p>{att.state === 'SETUP_REQUIRED' && <p role="status" className="rounded-lg border border-dashed p-3 text-sm">Attendance setup required: no complete policy is effective for this duty. Absence totals are unavailable. Other modules remain usable.</p>}{att.state === 'EMPTY_SCOPE' && <p className="text-sm">No employee duties in your authorized scope for this date.</p>}<Metrics items={Object.entries({ 'Actual records': att.metrics.recorded, 'Completed punches': att.metrics.completed, 'Open punches': att.metrics.open, 'Paid leave days': att.metrics.paidLeaveDays, 'Weekly offs': att.metrics.weeklyOff, 'Company holidays': att.metrics.holidays, 'No clock-in (ended duties)': att.metrics.noClockIn, 'Missing checkout': att.metrics.missingCheckout, 'Approved exceptions': att.metrics.approvedExceptions, 'Setup-required duties': att.metrics.setupRequired })} /><p className="text-xs text-muted-foreground">{att.definition}</p></>}<div className="flex flex-wrap gap-4"><Go to="/attendance">Open attendance workspace</Go><Go to="/reports">Open attendance reports</Go>{manage && <Go to="/attendance-settings">Review attendance setup</Go>}</div></>}</Panel>
        </div>
        <section aria-label="My work" className="space-y-5"><h2 className="text-xl font-semibold">My work</h2><p className="text-sm text-muted-foreground">Personal information is separate from management and team summaries.</p><div className="grid items-start gap-6 xl:grid-cols-2"><Panel title="My monthly leave" widget={personal}>{my && <>{my.state === 'PROFILE_LINK_REQUIRED' ? <p className="text-sm">No employee profile is linked to this account. Contact Admin/HR; management and assigned-team tools remain available where authorized.</p> : <><p className="text-sm">{my.employee.fullName} · {my.employee.employeeCode} · Leave month {my.leave.month} (PKT)</p><Metrics items={[["Allowance (paid full day)", my.leave.allowance], ['Pending / reserved', my.leave.reserved], ['Approved / used', my.leave.used], ['Available', my.leave.available]]} /><p className="text-xs text-muted-foreground">Unused allowance expires at month-end. No carry-forward, half-day or unpaid option; no automatic payroll adjustment. Past months in Leave show expired unused amounts.</p></>}<Go to="/leaves">Open my leave</Go></>}</Panel>
            <Panel title="My latest payslip" widget={payslip}>{slip && <>{slip.state === 'PROFILE_LINK_REQUIRED' ? <p className="text-sm">An employee profile link is required for your payslips.</p> : slip.latest ? <><p className="text-sm">Payroll month {slip.latest.month} · {slip.latest.status}. Only finally approved/paid own records are available.</p><Go to={slip.latest.link}>Open my latest payslip</Go></> : <p className="text-sm">No finally approved or paid payslip is available for your employee profile.</p>}<div><Go to="/my-payslips">Open my payslip history</Go></div></>}</Panel></div>
            {my?.state === 'LINKED' && <div className="grid items-start gap-6 xl:grid-cols-2"><AttendanceClock key={`clock:${user.id}`} /><MyShift key={`shift:${user.id}`} /></div>}
        </section>
        <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]"><RecentAnnouncements widget={announcements} /><InboxSummary key={user.id} user={user} /></div>
        <section aria-label="Useful shortcuts" className="space-y-3 rounded-2xl border bg-card p-5"><h2 className="text-lg font-semibold">Useful shortcuts</h2><div className="flex flex-wrap gap-5">{manage && <><Go to="/employees">Employee management</Go><Go to="/organization">Organization workspace</Go><Go to="/payroll">Salary & payroll workspace</Go><Go to="/announcements">Announcement workspace</Go></>}{team && <Go to="/my-employees">My employee workspace</Go>}<Go to="/attendance">Attendance workspace</Go><Go to="/leaves">Leave workspace</Go><Go to="/notifications">Notification inbox</Go><Go to="/account">Manage my account</Go></div></section>
    </div>;
}
