import {Megaphone,CalendarCheck,Receipt,Info,AlertTriangle} from 'lucide-react';
export default function NotificationGlyph({type}){const Icon=type==='ANNOUNCEMENT'?Megaphone:['ATTENDANCE','LEAVE'].includes(type)?CalendarCheck:type==='PAYROLL'?Receipt:type==='WARNING'?AlertTriangle:Info;return <Icon aria-hidden="true" className="size-4 shrink-0 text-primary"/>;}
