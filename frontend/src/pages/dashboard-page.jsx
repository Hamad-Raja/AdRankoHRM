import {useAuth} from '@/context/auth-context';
import AdminDashboard from './admin-dashboard-page';
import HrDashboard from './hr-dashboard-page';
import EmployeeDashboard from './employee-dashboard-page';
import ManagerDashboard from './manager-dashboard-page';
export default function DashboardPage(){const {user}=useAuth(),key=user.id+':'+user.role;return user.role==='ADMIN'?<AdminDashboard key={key}/>:user.role==='HR'?<HrDashboard key={key}/>:user.role==='MANAGER'?<ManagerDashboard key={key}/>:<EmployeeDashboard key={key}/>;}
