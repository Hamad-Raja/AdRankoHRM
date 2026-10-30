export const INBOX_CHANGED='officehr-inbox-changed';
export const inboxChanged=()=>window.dispatchEvent(new Event(INBOX_CHANGED));
