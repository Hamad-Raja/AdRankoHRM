import {ThemedSelect} from './themed-select';
import {cn} from '@/lib/utils';
export function EmploymentSelect({placeholder='Select\u2026',className,...props}){return <ThemedSelect placeholder={placeholder} className={cn('h-11',className)} {...props}/>;}
