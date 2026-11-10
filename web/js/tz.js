// Time zones for Lumen OS. The board needs a POSIX TZ rule (it has no zone
// database), so each entry maps an IANA name to its rule, including daylight
// saving. Shared by the desktop's Settings and the web installer.
export const ZONES = [
  ['Pacific/Honolulu', 'HST10'],
  ['America/Anchorage', 'AKST9AKDT,M3.2.0,M11.1.0'],
  ['America/Los_Angeles', 'PST8PDT,M3.2.0,M11.1.0'],
  ['America/Vancouver', 'PST8PDT,M3.2.0,M11.1.0'],
  ['America/Tijuana', 'PST8PDT,M3.2.0,M11.1.0'],
  ['America/Phoenix', 'MST7'],
  ['America/Denver', 'MST7MDT,M3.2.0,M11.1.0'],
  ['America/Edmonton', 'MST7MDT,M3.2.0,M11.1.0'],
  ['America/Chicago', 'CST6CDT,M3.2.0,M11.1.0'],
  ['America/Winnipeg', 'CST6CDT,M3.2.0,M11.1.0'],
  ['America/Mexico_City', 'CST6'],
  ['America/Regina', 'CST6'],
  ['America/New_York', 'EST5EDT,M3.2.0,M11.1.0'],
  ['America/Detroit', 'EST5EDT,M3.2.0,M11.1.0'],
  ['America/Toronto', 'EST5EDT,M3.2.0,M11.1.0'],
  ['America/Indiana/Indianapolis', 'EST5EDT,M3.2.0,M11.1.0'],
  ['America/Bogota', '<-05>5'],
  ['America/Lima', '<-05>5'],
  ['America/Halifax', 'AST4ADT,M3.2.0,M11.1.0'],
  ['America/Puerto_Rico', 'AST4'],
  ['America/Caracas', '<-04>4'],
  ['America/Santiago', '<-04>4<-03>,M9.1.6/24,M4.1.6/24'],
  ['America/St_Johns', 'NST3:30NDT,M3.2.0,M11.1.0'],
  ['America/Sao_Paulo', '<-03>3'],
  ['America/Argentina/Buenos_Aires', '<-03>3'],
  ['Atlantic/Azores', '<-01>1<+00>,M3.5.0/0,M10.5.0/1'],
  ['UTC', 'UTC0'],
  ['Europe/London', 'GMT0BST,M3.5.0/1,M10.5.0'],
  ['Europe/Dublin', 'IST-1GMT0,M10.5.0,M3.5.0/1'],
  ['Europe/Lisbon', 'WET0WEST,M3.5.0/1,M10.5.0'],
  ['Africa/Lagos', 'WAT-1'],
  ['Europe/Paris', 'CET-1CEST,M3.5.0,M10.5.0/3'],
  ['Europe/Berlin', 'CET-1CEST,M3.5.0,M10.5.0/3'],
  ['Europe/Madrid', 'CET-1CEST,M3.5.0,M10.5.0/3'],
  ['Europe/Rome', 'CET-1CEST,M3.5.0,M10.5.0/3'],
  ['Europe/Amsterdam', 'CET-1CEST,M3.5.0,M10.5.0/3'],
  ['Europe/Stockholm', 'CET-1CEST,M3.5.0,M10.5.0/3'],
  ['Europe/Warsaw', 'CET-1CEST,M3.5.0,M10.5.0/3'],
  ['Europe/Zurich', 'CET-1CEST,M3.5.0,M10.5.0/3'],
  ['Africa/Cairo', 'EET-2EEST,M4.5.5/0,M10.5.4/24'],
  ['Africa/Johannesburg', 'SAST-2'],
  ['Europe/Athens', 'EET-2EEST,M3.5.0/3,M10.5.0/4'],
  ['Europe/Helsinki', 'EET-2EEST,M3.5.0/3,M10.5.0/4'],
  ['Europe/Kyiv', 'EET-2EEST,M3.5.0/3,M10.5.0/4'],
  ['Asia/Jerusalem', 'IST-2IDT,M3.4.4/26,M10.5.0'],
  ['Europe/Istanbul', '<+03>-3'],
  ['Europe/Moscow', 'MSK-3'],
  ['Asia/Riyadh', '<+03>-3'],
  ['Africa/Nairobi', 'EAT-3'],
  ['Asia/Tehran', '<+0330>-3:30'],
  ['Asia/Dubai', '<+04>-4'],
  ['Asia/Kabul', '<+0430>-4:30'],
  ['Asia/Karachi', 'PKT-5'],
  ['Asia/Kolkata', 'IST-5:30'],
  ['Asia/Kathmandu', '<+0545>-5:45'],
  ['Asia/Dhaka', '<+06>-6'],
  ['Asia/Yangon', '<+0630>-6:30'],
  ['Asia/Bangkok', '<+07>-7'],
  ['Asia/Jakarta', 'WIB-7'],
  ['Asia/Ho_Chi_Minh', '<+07>-7'],
  ['Asia/Shanghai', 'CST-8'],
  ['Asia/Hong_Kong', 'HKT-8'],
  ['Asia/Singapore', '<+08>-8'],
  ['Asia/Taipei', 'CST-8'],
  ['Asia/Manila', 'PST-8'],
  ['Australia/Perth', 'AWST-8'],
  ['Asia/Seoul', 'KST-9'],
  ['Asia/Tokyo', 'JST-9'],
  ['Australia/Darwin', 'ACST-9:30'],
  ['Australia/Adelaide', 'ACST-9:30ACDT,M10.1.0,M4.1.0/3'],
  ['Australia/Brisbane', 'AEST-10'],
  ['Australia/Sydney', 'AEST-10AEDT,M10.1.0,M4.1.0/3'],
  ['Australia/Melbourne', 'AEST-10AEDT,M10.1.0,M4.1.0/3'],
  ['Australia/Hobart', 'AEST-10AEDT,M10.1.0,M4.1.0/3'],
  ['Pacific/Guam', 'ChST-10'],
  ['Pacific/Noumea', '<+11>-11'],
  ['Pacific/Auckland', 'NZST-12NZDT,M9.5.0,M4.1.0/3'],
  ['Pacific/Fiji', '<+12>-12'],
  ['Pacific/Tongatapu', '<+13>-13'],
];

const MAP = new Map(ZONES);

// Best guess for this browser: its own zone if known, else a fixed offset.
export function guessZone() {
  let name = '';
  try { name = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
  if (name === 'Asia/Calcutta') name = 'Asia/Kolkata';
  if (name === 'Europe/Kiev') name = 'Europe/Kyiv';
  if (MAP.has(name)) return { name, tz: MAP.get(name) };
  const off = -new Date().getTimezoneOffset();      // minutes east of UTC
  const sign = off >= 0 ? '-' : '';                 // POSIX sign is inverted
  const a = Math.abs(off);
  const hm = `${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
  return { name: name || `UTC${off >= 0 ? '+' : '-'}${hm}`, tz: `<${off >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}${a % 60 ? String(a % 60).padStart(2, '0') : ''}>${sign}${hm}` };
}

export const tzFor = (name) => MAP.get(name) || '';

// "America/New_York" -> "New York (America)" with the current UTC offset.
export function zoneLabel(name) {
  const parts = name.split('/');
  const city = parts[parts.length - 1].replace(/_/g, ' ');
  let off = '';
  try {
    off = new Intl.DateTimeFormat('en-US', { timeZone: name, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || '';
  } catch { /* ignore */ }
  return parts.length > 1 ? `${city} — ${parts[0]}${off ? ' · ' + off.replace('GMT', 'UTC') : ''}` : name;
}
