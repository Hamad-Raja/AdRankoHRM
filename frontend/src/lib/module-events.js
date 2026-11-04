export const INBOX_CHANGED='officehr-inbox-changed';
export const inboxChanged=()=>window.dispatchEvent(new Event(INBOX_CHANGED));
export const INBOX_SNAPSHOT='officehr-inbox-snapshot';
let latestInboxSnapshot=null;
export function publishInboxSnapshot(snapshot){latestInboxSnapshot=snapshot;window.dispatchEvent(new Event(INBOX_SNAPSHOT));}
export const getInboxSnapshot=ownerId=>latestInboxSnapshot?.ownerId===ownerId?latestInboxSnapshot:null;
