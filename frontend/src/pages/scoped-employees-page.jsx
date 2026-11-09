import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Panel, History } from '@/components/employees/management-widgets';
import { dateOnly } from '@/components/employees/management-utils';
import { Documents } from '@/pages/employee-detail-page';
import { useAuth } from '@/context/auth-context';
import * as org from '@/services/organization.service';
export default function ScopedEmployeesPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0), [history, setHistory] = useState(null);
  useEffect(() => { const c = new AbortController();
    org.scopeEmployees({ signal: c.signal }).then(async rows => { if (c.signal.aborted) return; setEmployees(rows); setError(''); if (user.role === 'EMPLOYEE' && rows[0]) setHistory(await org.history(rows[0].id, { signal: c.signal })); }).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort();
  }, [revision, user.role]);
  return <section className="mx-auto max-w-4xl space-y-6"><h1 className="text-2xl font-semibold">{user.role === 'MANAGER' ? 'My team employees' : 'My employee profile'}</h1>
    <p className="text-sm text-muted-foreground">{user.role === 'MANAGER' ? 'Current team membership grants basic identity and employment information only.' : 'Self-service is read-only. Contact HR to request corrections.'}</p>
    {error && <p role="alert">{error}</p>}<Button variant="outline" onClick={() => setRevision(v => v + 1)}>Refresh profiles</Button>
    {!employees && !error && <p role="status">Loading permitted profiles…</p>}{employees?.length === 0 && <p>No linked employee profile or current team employees.</p>}
    {employees?.map(e => <Panel key={e.id} title={`${e.fullName} · ${e.employeeCode}`}><p>{e.employmentEpisodes[0]?.status || 'No employment'} · Joined {e.employmentEpisodes[0] ? dateOnly(e.employmentEpisodes[0].startDate) : 'Not recorded'}</p>{e.assignments.map(a => <p key={a.id}>{a.team?.name||'No team'} · {a.designation?.name} · {a.department?.name||a.team?.department?.name} / {a.campaign?.name||a.team?.campaign?.name||'No campaign'}</p>)}</Panel>)}
    {history && <History data={history} />}{user.role === 'EMPLOYEE' && employees?.[0] && <Documents employeeId={employees[0].id} management={false} />}
  </section>;
}

