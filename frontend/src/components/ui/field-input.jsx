import {cn} from '@/lib/utils';
import {fieldAppearance} from './field-styles';

// Keep native picker, file, input events and refs; only standardize field shells.
export function FieldInput({className,type,...props}) {
  const bare=['checkbox','radio','hidden','range','color','submit','button','reset'].includes(type);
  return <input {...props} type={type} className={bare?className:cn(className,fieldAppearance)}/>;
}
export function FieldTextarea({className,...props}) {
  return <textarea {...props} className={cn(className,fieldAppearance)}/>;
}
