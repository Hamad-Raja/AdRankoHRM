// Return only to known application routes allowed for the current role.
export function loginDestination(requested, role) {
  if (typeof requested !== 'string' || requested.length > 2048
      || !requested.startsWith('/') || requested.startsWith('//')
      || requested.includes('\\') || [...requested].some(character => {
        const code = character.charCodeAt(0);
        return code <= 32 || code === 127;
      })) return '/dashboard';
  const url = new URL(requested, 'https://officehr.invalid');
  const common = ['/dashboard', '/account', '/attendance', '/reports', '/my-payslips', '/announcements', '/notifications', '/leaves', '/my-profile', '/employment'];
  const management = ['ADMIN', 'HR'].includes(role)
    && /^\/(employees(?:\/new|\/[0-9a-f-]{36})?|organization|attendance-settings|shifts)$/.test(url.pathname);
  const reportDetail = /^\/reports\/attendance\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(url.pathname);
  const selfService = ['MANAGER', 'EMPLOYEE'].includes(role) && url.pathname === '/my-employees';
  return ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'].includes(role)
    && (common.includes(url.pathname) || role === 'ADMIN' && ['/audit', '/employee-records'].includes(url.pathname) || management || selfService || reportDetail
      || ['ADMIN', 'HR'].includes(role) && url.pathname === '/payroll')
    ? url.pathname + url.search : '/dashboard';
}
