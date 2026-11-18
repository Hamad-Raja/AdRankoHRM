import {Navigate, useLocation, useSearchParams} from 'react-router';
import {BriefcaseBusiness, FolderLock, Info, LockKeyhole, ShieldCheck, UserRound} from 'lucide-react';
import {useApiResource} from '@/lib/use-api-resource';
import {useAuth} from '@/context/auth-context';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {EmploymentBadge, InitialsAvatar} from '@/components/employees/directory-parts';
import {employeeDate, employmentStatuses, employmentTypes} from '@/components/employees/employee-options';
import {Documents} from './employee-detail-page';
import {AccountSecurityContent, AccountStatusBadge, ROLE_LABELS} from './account-page';

const TABS = [
  {id: 'personal', label: 'Personal Details'},
  {id: 'employment', label: 'Employment History'},
  {id: 'documents', label: 'Documents'},
  {id: 'security', label: 'Account & Security'},
];

const formatDate = value => value ? employeeDate(value.slice(0, 10)) : 'Not recorded';
const statusLabel = value => employmentStatuses.find(([status]) => status === value)?.[1] || 'Not recorded';

function ProfileIdentity({user, employee}) {
  const name = employee?.fullName || user.displayName;
  const employment = employee?.employmentEpisodes[0];
  return <section aria-label="Profile identity" className="min-w-0 rounded-2xl border border-border bg-gradient-to-r from-card via-card to-primary/5 p-5 shadow-xs sm:p-6">
    <div className="flex min-w-0 flex-wrap items-center gap-5">
      <div className="[&>span]:size-16 [&>span]:text-xl"><InitialsAvatar name={name} /></div>
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="break-words text-2xl font-semibold tracking-tight">{name}</h2>
        {employee?.employeeCode && <p className="mt-1 break-words text-sm text-muted-foreground">Employee code: <span className="font-semibold text-foreground">{employee.employeeCode}</span></p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
          <span className="inline-flex flex-wrap items-center gap-2">Account status <AccountStatusBadge status={user.status} /></span>
          {employment && <span className="inline-flex flex-wrap items-center gap-2">Employment status <EmploymentBadge status={employment.status} /></span>}
        </div>
      </div>
    </div>
  </section>;
}

function ProfilePanel({title, icon: Icon, children}) {
  return <section className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6">
    <h2 className="flex items-center gap-3 text-lg font-semibold"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon aria-hidden="true" className="size-5" /></span>{title}</h2>
    {children}
  </section>;
}

function ProfileFields({rows}) {
  return <dl className="mt-4 divide-y divide-border">{rows.map(([label, value]) => <div key={label} className="grid min-w-0 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] sm:gap-4">
    <dt className="text-sm font-medium text-foreground/80">{label}</dt><dd className={`min-w-0 break-words text-sm ${value ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{value || 'Not recorded'}</dd>
  </div>)}</dl>;
}

function ProfileEmployment({episodes}) {
  return <ProfilePanel title="Employment History" icon={BriefcaseBusiness}>
    <p className="mt-3"><Badge variant="secondary">{episodes.length} employment {episodes.length === 1 ? 'period' : 'periods'}</Badge></p>
    {!episodes.length ? <p className="mt-4 text-sm text-muted-foreground">No employment periods recorded.</p> : <ol className="mt-5 ml-2 space-y-6 border-l-2 border-primary/20 pl-6">
      {episodes.map(episode => <li key={episode.id} className="relative min-w-0">
        <span aria-hidden="true" className="absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-card bg-primary" />
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-words text-base font-semibold">{formatDate(episode.startDate)} – {episode.endDate ? formatDate(episode.endDate) : 'Present'}</h3><EmploymentBadge status={episode.status} /></div>
        <ProfileFields rows={[
          ['Start date', formatDate(episode.startDate)],
          ['End date', episode.endDate ? formatDate(episode.endDate) : 'Present'],
          ['Employment type', employmentTypes.find(([type]) => type === episode.employmentType)?.[1]],
        ]} />
        {episode.statusEvents?.length ? <ul className="mt-3 space-y-3 rounded-xl border border-border bg-background/40 p-3">{episode.statusEvents.map(event => <li key={event.id} className="min-w-0"><p className="break-words text-sm font-medium">{event.fromStatus ? `${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}` : `Initial employment · ${statusLabel(event.toStatus)}`}</p><p className="mt-1 text-xs text-muted-foreground">Effective {formatDate(event.effectiveDate)}</p></li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">{Array.isArray(episode.statusEvents) ? 'No status events recorded.' : 'Status events unavailable.'}</p>}
      </li>)}
    </ol>}
  </ProfilePanel>;
}

export default function MyProfilePage() {
  const {user} = useAuth();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const requestedTab = search.get('tab');
  const tab = TABS.some(item => item.id === requestedTab) ? requestedTab : 'personal';
  const restricted = user.mustChangePassword;
  const accountOnly = user.role === 'ADMIN';
  // Security remains independent of profile loading, errors or a missing link.
  // Forced-change accounts never request or render employee resources.
  const resource = useApiResource(!accountOnly && !restricted && tab !== 'security' ? '/employment/self-profile' : null);
  const employee = resource.data?.employee;

  if ((restricted || accountOnly) && requestedTab !== 'security') {
    const next = new URLSearchParams(search);
    next.set('tab', 'security');
    return <Navigate to={{pathname: location.pathname, search: `?${next}`, hash: location.hash}} state={location.state} replace />;
  }

  if (accountOnly) return <section className="profile-page min-w-0 space-y-6 text-foreground">
    <header><h1 className="text-2xl font-semibold">Account &amp; Security</h1><p className="mt-2 text-sm text-muted-foreground">Your account details and password security.</p></header>
    <ProfileIdentity user={user} />
    <AccountSecurityContent />
  </section>;

  function selectTab(id) {
    if (id === tab) return;
    const next = new URLSearchParams(search);
    next.set('tab', id);
    setSearch(next, {state: location.state});
  }

  function moveTabFocus(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]:not(:disabled)')];
    const index = tabs.indexOf(event.target);
    if (index === -1) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    // Keep selection and the roving keyboard focus together.
    tabs[next].focus();
    tabs[next].click();
  }

  return <section className="profile-page min-w-0 space-y-6 text-foreground">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">My Profile</h1><p className="mt-2 text-sm text-muted-foreground">Your personal and account details.</p></div>
      <Badge variant="secondary" className="h-auto gap-2 px-3 py-1.5"><LockKeyhole aria-hidden="true" className="size-3.5" />Read-only profile</Badge>
    </header>
    <ProfileIdentity user={user} employee={employee} />
    <div role="tablist" aria-label="My Profile sections" onKeyDown={moveTabFocus} className="app-tabs">
      {TABS.map(item => <Button key={item.id} id={`profile-tab-${item.id}`} role="tab" type="button"
        aria-selected={tab === item.id} aria-controls={`profile-panel-${item.id}`}
        tabIndex={tab === item.id ? 0 : -1} disabled={restricted && item.id !== 'security'}
        variant={tab === item.id ? 'default' : 'outline'} className="h-auto min-h-10 min-w-0 whitespace-normal px-3 py-2 text-sm"
        onClick={() => selectTab(item.id)}>{item.label}</Button>)}
    </div>
    <div id={`profile-panel-${tab}`} role="tabpanel" aria-labelledby={`profile-tab-${tab}`} tabIndex={0}
      className="min-w-0 space-y-6 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      {tab === 'security' ? <AccountSecurityContent />
        : resource.loading ? <p role="status">Loading your profile...</p>
        : resource.error ? <div role="alert"><p>{resource.error.message}</p><Button onClick={() => void resource.reload().catch(() => {})}>Retry profile</Button></div>
        : !employee ? <p>No employee profile is linked to your account. Account &amp; Security is still available.</p>
        : tab === 'personal' ? <>
          <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <ProfilePanel title="Personal information" icon={UserRound}><ProfileFields rows={[
              ['Personal email', employee.personalEmail], ['Phone', employee.phone], ['CNIC', employee.cnic], ['Location', employee.location], ['Address', employee.address],
            ]} /></ProfilePanel>
            <ProfilePanel title="Emergency contact" icon={ShieldCheck}><ProfileFields rows={[
              ['Name', employee.emergencyContactName], ['Relationship', employee.emergencyContactRelationship], ['Phone', employee.emergencyContactPhone],
            ]} /><p className="mt-2 text-xs text-muted-foreground">For urgent contact only.</p></ProfilePanel>
          </div>
          <p className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground"><LockKeyhole aria-hidden="true" className="size-4 shrink-0" />Profile details are managed by Admin and HR.</p>
        </>
        : tab === 'employment' ? <ProfileEmployment episodes={employee.employmentEpisodes} />
        : user.role !== 'MANAGER' ? <Documents employeeId={employee.id} management={false} organizationView />
        : <ProfilePanel title="Private documents" icon={FolderLock}><p className="mt-4 text-sm text-muted-foreground">Contact HR for your private documents. Existing Manager document restrictions apply.</p></ProfilePanel>}
    </div>
    {tab === 'security' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Info aria-hidden="true" className="size-4 shrink-0" />Your account details are read-only.</p>}
  </section>;
}
