import {Navigate, useLocation, useSearchParams} from 'react-router';
import {useApiResource} from '@/lib/use-api-resource';
import {useAuth} from '@/context/auth-context';
import {Button} from '@/components/ui/button';
import {Documents} from './employee-detail-page';
import {AccountSecurityContent} from './account-page';

const TABS = [
  {id: 'personal', label: 'Personal Details'},
  {id: 'employment', label: 'Employment History'},
  {id: 'documents', label: 'Documents'},
  {id: 'security', label: 'Account & Security'},
];

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

  if (accountOnly) return <section className="min-w-0 space-y-6">
    <header><h1 className="text-2xl font-semibold">Account &amp; Security</h1><p className="mt-2 text-sm text-muted-foreground">Your account details and password security.</p></header>
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

  return <section className="min-w-0 space-y-6">
    <header>
      <h1 className="text-2xl font-semibold">My Profile</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your employee details are read-only. Contact Admin or HR for changes.</p>
    </header>
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
        : tab === 'personal' ? <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">{employee.fullName} · {employee.employeeCode}</h2>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            {['personalEmail', 'phone', 'address', 'cnic', 'location', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship'].map(key =>
              <div key={key}><dt className="text-sm capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="mt-1 break-words">{employee[key] || 'Not recorded'}</dd></div>)}
          </dl>
        </div>
        : tab === 'employment' ? <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Employment History</h2>
          {employee.employmentEpisodes.map(episode => <p key={episode.id} className="mt-3 text-sm">
            {episode.startDate.slice(0, 10)} — {episode.endDate?.slice(0, 10) || 'Open'} · {episode.status} · {episode.employmentType || 'Type not recorded'}
          </p>)}
        </div>
        : user.role !== 'MANAGER' ? <Documents employeeId={employee.id} management={false} />
        : <p className="text-sm text-muted-foreground">Contact HR for your private documents. Existing Manager document restrictions apply.</p>}
    </div>
  </section>;
}
