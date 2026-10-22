export const formObject = form => Object.fromEntries([...form].filter(([, value]) => typeof value === 'string' && value !== ''));
export const dateOnly = value => value ? value.slice(0, 10) : 'Open';
