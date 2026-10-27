import { Navigate } from 'react-router';
// Compatibility only: the old multi-shift screen has been replaced.
export default function ShiftManagementPage() { return <Navigate to="/attendance-settings" replace />; }
