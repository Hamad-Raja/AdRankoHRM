import {Badge} from '@/components/ui/badge';
import {employmentStatuses} from './employee-options';

export function InitialsAvatar({name,small=false}) {
  const words=(name||'').trim().split(/\s+/).filter(Boolean),initials=words.length?words[0][0]+(words.length>1?words.at(-1)[0]:''):'';
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/15 font-semibold uppercase text-primary ${small?'size-7 text-xs':'size-10 text-sm'}`}>{initials||'—'}</span>;
}
export function EmploymentBadge({status}){
  const color={ACTIVE:'border-primary/30 bg-primary/10 text-primary',PROBATION:'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',NOTICE_PERIOD:'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300',SUSPENDED:'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300'}[status]||'border-border bg-muted text-muted-foreground';
  return <Badge variant="outline" className={`whitespace-nowrap ${color}`}>{employmentStatuses.find(([value])=>value===status)?.[1]||'No employment'}</Badge>;
}
