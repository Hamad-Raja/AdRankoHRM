import { useEffect, useState } from 'react';
import { RefreshCw, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmploymentBadge } from '@/components/employees/directory-parts';
import { employeeDate } from '@/components/employees/employee-options';
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
  if (user.role === 'MANAGER') return (
    <section className="mx-auto min-w-0 max-w-[1440px] space-y-6" aria-label="My team">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">My Team</h1>
          <p className="mt-2 text-base text-muted-foreground">Your team's profiles, roles, and employment details.</p>
        </div>
        <Button size="lg" onClick={() => setRevision(v => v + 1)}>
          <RefreshCw aria-hidden="true" />Refresh profiles
        </Button>
      </header>

      <section aria-labelledby="team-members-heading" className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-xs">
        <header className="flex flex-wrap items-center gap-3 px-5 py-5 sm:px-6">
          <h2 id="team-members-heading" className="text-xl font-semibold tracking-tight">Team members</h2>
          {employees && !error && <Badge variant="outline" className="h-auto border-primary/20 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{employees.length} {employees.length === 1 ? 'employee' : 'employees'}</Badge>}
        </header>

        {error ? (
          <div role="alert" className="space-y-2 px-5 pb-6 sm:px-6">
            <p className="font-medium">Unable to load team profiles</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : !employees ? (
          <p role="status" className="px-5 py-12 text-center text-sm text-muted-foreground">Loading team profiles...</p>
        ) : employees.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
            <UsersRound aria-hidden="true" className="size-9 text-muted-foreground" />
            <p className="font-medium">No current team members</p>
            <p className="text-sm text-muted-foreground">No employees are currently assigned to your teams.</p>
          </div>
        ) : (
          <div className="px-4 sm:px-5">
            <div role="region" aria-label="Team member profiles" tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <caption className="sr-only">Current team members, organization assignments and employment details</caption>
                <thead className="bg-muted/60">
                  <tr>{['Employee', 'Designation / team', 'Department / campaign', 'Joined', 'Status'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {employees.map(employee => {
                    const employment = employee.employmentEpisodes[0];
                    return <tr key={employee.id} className="hover:bg-muted/30">
                      <th scope="row" className="px-4 py-4 font-normal">
                        <p className="font-semibold">{employee.fullName}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{employee.employeeCode}</p>
                      </th>
                      <td className="px-4 py-4">{employee.assignments.length ? employee.assignments.map(assignment => <div key={assignment.id} className="space-y-1 [&+div]:mt-3"><p className="font-medium">{assignment.designation?.name || 'Not recorded'}</p><p className="text-muted-foreground">{assignment.team?.name || 'No team'}</p></div>) : <span className="text-muted-foreground">Not recorded</span>}</td>
                      <td className="px-4 py-4">{employee.assignments.length ? employee.assignments.map(assignment => <div key={assignment.id} className="space-y-1 [&+div]:mt-3"><p className="font-medium">{assignment.department?.name || assignment.team?.department?.name || 'Not recorded'}</p><p className="text-muted-foreground">{assignment.campaign?.name || assignment.team?.campaign?.name || 'No campaign'}</p></div>) : <span className="text-muted-foreground">Not recorded</span>}</td>
                      <td className="whitespace-nowrap px-4 py-4">{employment ? employeeDate(dateOnly(employment.startDate)) : 'Not recorded'}</td>
                      <td className="px-4 py-4"><EmploymentBadge status={employment?.status} /></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {employees && !error && <footer className="mx-5 mt-4 border-t border-border py-4 text-sm text-muted-foreground sm:mx-6">Showing {employees.length} team {employees.length === 1 ? 'member' : 'members'}.</footer>}
      </section>
    </section>
  );
  return <section className="mx-auto max-w-4xl space-y-6"><h1 className="text-2xl font-semibold">{user.role === 'MANAGER' ? 'My team employees' : 'My employee profile'}</h1>
    <p className="text-sm text-muted-foreground">{user.role === 'MANAGER' ? 'Current team membership grants basic identity and employment information only.' : 'Self-service is read-only. Contact HR to request corrections.'}</p>
    {error && <p role="alert">{error}</p>}<Button variant="outline" onClick={() => setRevision(v => v + 1)}>Refresh profiles</Button>
    {!employees && !error && <p role="status">Loading permitted profiles…</p>}{employees?.length === 0 && <p>No linked employee profile or current team employees.</p>}
    {employees?.map(e => <Panel key={e.id} title={`${e.fullName} · ${e.employeeCode}`}><p>{e.employmentEpisodes[0]?.status || 'No employment'} · Joined {e.employmentEpisodes[0] ? dateOnly(e.employmentEpisodes[0].startDate) : 'Not recorded'}</p>{e.assignments.map(a => <p key={a.id}>{a.team?.name||'No team'} · {a.designation?.name} · {a.department?.name||a.team?.department?.name} / {a.campaign?.name||a.team?.campaign?.name||'No campaign'}</p>)}</Panel>)}
    {history && <History data={history} />}{user.role === 'EMPLOYEE' && employees?.[0] && <Documents employeeId={employees[0].id} management={false} />}
  </section>;
}

