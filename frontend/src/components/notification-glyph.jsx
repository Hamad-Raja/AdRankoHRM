import {Megaphone,CalendarCheck,Receipt,Info,AlertTriangle} from 'lucide-react';
export default function NotificationGlyph({type}){const Icon=type==='ANNOUNCEMENT'?Megaphone:type==='ATTENDANCE'?CalendarCheck:type==='PAYROLL'?Receipt:type==='WARNING'?AlertTriangle:Info;return <Icon aria-hidden="true" className="size-4 shrink-0 text-primary"/>;}
