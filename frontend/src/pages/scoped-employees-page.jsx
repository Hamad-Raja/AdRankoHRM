import { useEffect, useState } from 'react';
import { RefreshCw, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmploymentBadge } from '@/components/employees/directory-parts';
import { employeeDate, employmentStatuses } from '@/components/employees/employee-options';
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
          <div className="px-4 pb-5 sm:px-5">
            <div role="region" aria-label="Team member profiles" tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
              <table className="w-full min-w-[64rem] table-fixed text-left text-sm [overflow-wrap:anywhere]">
                <caption className="sr-only">Current team members, organization assignments and employment details</caption>
                <colgroup><col span={6} /><col className="w-32" /><col className="w-36" /></colgroup>
                <thead className="bg-muted/60">
                  <tr>{['Employee', 'Code', 'Designation', 'Team', 'Department', 'Campaign', 'Joined', 'Status'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {employees.map(employee => {
                    const employment = employee.employmentEpisodes[0];
                    return <tr key={employee.id} className="hover:bg-muted/30">
                      <th scope="row" className="px-4 py-3 font-semibold">{employee.fullName}</th>
                      <td className="px-4 py-3">{employee.employeeCode}</td>
                      <td className="px-4 py-3">{employee.assignments.length ? employee.assignments.map(assignment => <p key={assignment.id} className="[&+p]:mt-3">{assignment.designation?.name || 'Not recorded'}</p>) : <span className="text-muted-foreground">Not recorded</span>}</td>
                      <td className="px-4 py-3">{employee.assignments.length ? employee.assignments.map(assignment => <p key={assignment.id} className="[&+p]:mt-3">{assignment.team?.name || 'No team'}</p>) : <span className="text-muted-foreground">Not recorded</span>}</td>
                      <td className="px-4 py-3">{employee.assignments.length ? employee.assignments.map(assignment => <p key={assignment.id} className="[&+p]:mt-3">{assignment.department?.name || assignment.team?.department?.name || 'Not recorded'}</p>) : <span className="text-muted-foreground">Not recorded</span>}</td>
                      <td className="px-4 py-3">{employee.assignments.length ? employee.assignments.map(assignment => <p key={assignment.id} className="[&+p]:mt-3">{assignment.campaign?.name || assignment.team?.campaign?.name || 'No campaign'}</p>) : <span className="text-muted-foreground">Not recorded</span>}</td>
                      <td className="px-4 py-3">{employment ? employeeDate(dateOnly(employment.startDate)) : 'Not recorded'}</td>
                      <td className="px-4 py-3"><EmploymentBadge status={employment?.status} /></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </section>
    </section>
  );
  const employee = employees?.[0];
  const employment = employee?.employmentEpisodes[0];
  const assignment = employee?.assignments[0];
  const statusLabel = status => employmentStatuses.find(([value]) => value === status)?.[1] || 'No employment';
  const formatDate = value => value ? employeeDate(dateOnly(value)) : 'Not recorded';
  return (
    <section className="mx-auto min-w-0 max-w-[1440px] space-y-6" aria-label="My organization">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0"><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">My Organization</h1><p className="mt-2 text-base text-muted-foreground">Your current placement and employment history.</p></div>
        <Button size="lg" onClick={() => setRevision(v => v + 1)}><RefreshCw aria-hidden="true" />Refresh profile</Button>
      </header>
      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}

      <section aria-label="Current details" className="min-w-0 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xs sm:p-6">
        {!employee ? <><h2 className="text-xl font-semibold tracking-tight">Current details</h2><p role="status" className="mt-4 text-sm text-muted-foreground">{error ? 'Profile unavailable. Refresh profile to try again.' : employees ? 'No linked employee profile. Contact HR for assistance.' : 'Loading your profile...'}</p></> : <>
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
            <div className="min-w-0"><h2 className="break-words text-2xl font-semibold tracking-tight">{employee.fullName}</h2><p className="mt-1 break-words text-sm font-medium text-muted-foreground"><span className="sr-only">Employee code: </span>{employee.employeeCode}</p></div>
            <EmploymentBadge status={employment?.status} />
          </header>
          <dl className="mt-5 grid min-w-0 grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Designation', assignment?.designation?.name || 'Not recorded'],
              ['Team', assignment?.team?.name || 'No team'],
              ['Department', assignment?.department?.name || assignment?.team?.department?.name || 'Not recorded'],
              ['Campaign', assignment?.campaign?.name || assignment?.team?.campaign?.name || 'No campaign'],
              ['Joined', formatDate(employment?.startDate)],
              ['Employment status', statusLabel(employment?.status)],
            ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-base font-semibold">{value}</dd></div>)}
          </dl>
        </>}
      </section>

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
      <section aria-labelledby="organization-employment-history" className="min-w-0 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xs sm:p-6">
        <h2 id="organization-employment-history" className="text-xl font-semibold tracking-tight">Employment history</h2>
        {!employee || !history ? <p role="status" className="mt-5 text-sm text-muted-foreground">{error ? 'Employment history unavailable. Refresh profile to try again.' : !employee && employees ? 'No linked employee profile.' : 'Loading employment history...'}</p> : !history.episodes.length ? <p className="mt-5 text-sm text-muted-foreground">No employment periods recorded.</p> : (
          <div className="mt-5 space-y-5 divide-y divide-border">
            {history.episodes.map(episode => <article key={episode.id} aria-label="Employment period" className="min-w-0 space-y-4 [&+article]:pt-5">
              <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-sm text-muted-foreground">Period</dt><dd className="mt-1 break-words text-base font-semibold">{formatDate(episode.startDate)} – {episode.endDate ? formatDate(episode.endDate) : 'Present'}</dd></div>
                <div className="min-w-0"><dt className="text-sm text-muted-foreground">Status</dt><dd className="mt-1"><EmploymentBadge status={episode.status} /></dd></div>
              </dl>
              {episode.statusEvents.length ? episode.statusEvents.map(event => <dl key={event.id} className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-sm text-muted-foreground">Event</dt><dd className="mt-1 break-words text-base font-semibold">{event.fromStatus ? `${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}` : `Initial employment · ${statusLabel(event.toStatus)}`}</dd></div>
                <div className="min-w-0"><dt className="text-sm text-muted-foreground">Effective date</dt><dd className="mt-1 break-words text-base font-semibold">{formatDate(event.effectiveDate)}</dd></div>
              </dl>) : <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-sm text-muted-foreground">Event</dt><dd className="mt-1 break-words text-sm text-muted-foreground">No status events recorded.</dd></div>
                <div className="min-w-0"><dt className="text-sm text-muted-foreground">Effective date</dt><dd className="mt-1 break-words text-base font-semibold">{formatDate(episode.statusEffectiveDate)}</dd></div>
              </dl>}
            </article>)}
          </div>
        )}
      </section>

      {employee && <Documents key={employee.id} employeeId={employee.id} management={false} refreshKey={revision} organizationView />}
      </div>
      <p className="text-sm text-muted-foreground">Contact HR to request corrections to your information.</p>
    </section>
  );
}

