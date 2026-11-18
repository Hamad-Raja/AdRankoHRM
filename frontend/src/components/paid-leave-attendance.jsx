import { useEffect, useState } from 'react';
import { useAuth } from '@/context/auth-context';
import { getReport } from '@/services/reports.service';
import { karachiMonth } from '@/lib/reports';
import { Input } from '@/components/ui/input';

// Uses the existing dated employee/team report scope. Never fetches private reasons.
export default function PaidLeaveAttendance({ tabular = false }) {
    const { user } = useAuth(); const [month, setMonth] = useState(karachiMonth), [data, setData] = useState(null), [error, setError] = useState(''), [page, setPage] = useState(1), [search, setSearch] = useState('');
    const searchTerm = tabular ? search.trim() : '';
    useEffect(() => { const ctrl = new AbortController(); void getReport('attendance', new URLSearchParams({ month, status: 'PAID_LEAVE', page: String(page), pageSize: '20', ...(searchTerm ? { search: searchTerm } : {}) }).toString(), { signal: ctrl.signal }).then(result => { if (!ctrl.signal.aborted) { setData({ ownerId: user.id, month, page, search: searchTerm, ...result }); setError(''); } }).catch(e => { if (!ctrl.signal.aborted) setError(e.message); }); return () => ctrl.abort(); }, [month, page, user.id, searchTerm]);
    const current = data?.ownerId === user.id && data.month === month && data.page === page && data.search === searchTerm ? data : null;
    if (tabular) return <section aria-label="Approved paid leave attendance" className="space-y-6">
        <h2 className="text-base font-semibold tracking-tight text-foreground">Approved Paid Leave</h2>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
            <label className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Month<Input className="h-9 w-44 text-xs font-semibold" type="month" aria-label="Leave attendance month" value={month} onChange={e => { setMonth(e.target.value); setPage(1); }} /></label>
            <label className="w-full sm:ml-auto sm:w-auto"><span className="sr-only">Search approved paid leave employees</span><Input type="search" aria-label="Search approved paid leave employees" placeholder="Search name or employee code" maxLength={120} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-9 w-full text-xs sm:w-64" /></label>
        </div>
        {error ? <p role="alert">{error}</p> : <div className="rounded-2xl border border-border/80 bg-card shadow-xs overflow-hidden"><div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className="border-b border-border/80 bg-muted/40 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"><tr><th className="py-2.5 px-4">Employee</th><th className="py-2.5 px-4">Leave Date</th><th className="py-2.5 px-4">Days</th></tr></thead>
                <tbody className="divide-y divide-border/60">
                    {!current ? <tr><td colSpan={3} className="py-8 text-center text-xs text-muted-foreground" role="status">Loading approved leave...</td></tr> : !current.rows.length ? <tr><td colSpan={3} className="py-8 text-center text-xs text-muted-foreground">{searchTerm ? "No matching employees" : "No approved paid leave for this month"}</td></tr> : current.rows.map(r => <tr key={`${r.employee.id}:${r.shiftDate}`} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-semibold text-xs text-foreground"><div>{r.employee.fullName}</div><div className="text-[11px] text-muted-foreground font-mono font-normal">{r.employee.employeeCode}</div></td>
                        <td className="py-3 px-4 text-xs">{r.shiftDate}{r.leaveConflict && <p>Calendar/employment conflict: HR review required.</p>}{r.scheduleState === 'SETUP_REQUIRED' && <p>Attendance setup required; leave remains recorded.</p>}</td>
                        <td className="py-3 px-4 text-xs">1</td>
                    </tr>)}
                </tbody>
            </table>
        </div>
        {current && current.totalPages > 1 && <div className="flex gap-4 border-t border-border/80 p-4 text-sm"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous leave page</button><span>Page {page}</span><button disabled={page >= current.totalPages} onClick={() => setPage(p => p + 1)}>Next leave page</button></div>}
        </div>}
    </section>;
    return <section aria-label="Approved paid leave attendance" className="space-y-3 rounded-xl border bg-card p-4"><h2 className="font-semibold">Approved paid leave</h2><p className="text-sm text-muted-foreground">Full-day leave is separate from worked days and punches. Attendance scope applies; private reasons are omitted. Payroll remains manual.</p><label className="text-sm">Leave attendance month<Input type="month" aria-label="Leave attendance month" value={month} onChange={e => { setMonth(e.target.value); setPage(1); }} /></label>{error ? <p role="alert">{error}</p> : !current ? <p role="status">Loading approved leave...</p> : !current.rows.length ? <p className="text-sm">No approved paid leave in this scope and month.</p> : <ul className="space-y-2">{current.rows.map(r => <li key={`${r.employee.id}:${r.shiftDate}`} className="rounded-lg border p-3 text-sm">{r.shiftDate} · {r.employee.fullName} · 1 paid leave day. No punches created.{r.leaveConflict && ' Calendar/employment conflict: HR review required.'}{r.scheduleState === 'SETUP_REQUIRED' && ' Attendance setup required; leave remains recorded.'}</li>)}</ul>}<div className="flex gap-4 text-sm"><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous leave page</button><span>Page {page}</span><button disabled={!current || page >= current.totalPages} onClick={() => setPage(p => p + 1)}>Next leave page</button></div></section>;
}
