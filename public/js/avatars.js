// Illustrated avatars drawn as SVG, so there are no image files to ship.
// A user's avatar_key picks one; with no key we show initials on a colour from their name.
import { h, initials, fromHtml } from './util.js';

const SKIN = ['#f3c9a5', '#e0a77c', '#c88a5e', '#a86d46', '#f6d3b8'];
const HAIR = ['#1c1410', '#3a2415', '#5a3a22', '#8a5a2b', '#2b2b33', '#6b2a1d'];
// style: short | long | bun | curly | cap | bald | bob
export const AVATARS = {
  maria:   { bg: '#bcdad7', skin: 1, hair: 0, style: 'bun',   shirt: '#006768' },
  juan:    { bg: '#fbe3d2', skin: 2, hair: 0, style: 'short', shirt: '#d9692a' },
  ana:     { bg: '#dfeeed', skin: 0, hair: 1, style: 'long',  shirt: '#4f9d9a' },
  mark:    { bg: '#e6e9f5', skin: 3, hair: 0, style: 'cap',   shirt: '#3b4a8a' },
  elena:   { bg: '#f7e4ea', skin: 4, hair: 2, style: 'bob',   shirt: '#b3466a' },
  jayson:  { bg: '#e2f3ea', skin: 2, hair: 4, style: 'curly', shirt: '#1d7a4f' },
  cristine:{ bg: '#fdf0d9', skin: 0, hair: 3, style: 'long',  shirt: '#a96300' },
  ramon:   { bg: '#e9e4f3', skin: 3, hair: 4, style: 'short', shirt: '#5b3f9a', glasses: true },
  liza:    { bg: '#dfeaf2', skin: 1, hair: 5, style: 'bob',   shirt: '#2f6d91' },
  kuya:    { bg: '#f1e7d6', skin: 2, hair: 1, style: 'bald',  shirt: '#7a5a2a' },
};
export const AVATAR_KEYS = Object.keys(AVATARS);

function hairBack(a, c) {
  if (a.style === 'long') return `<path d="M20 44c-2-18 8-26 20-26s22 8 20 26l2 24H18z" fill="${c}"/>`;
  if (a.style === 'bob') return `<path d="M21 46c-3-17 6-27 19-27s22 10 19 27l-3 6H24z" fill="${c}"/>`;
  if (a.style === 'bun') return `<circle cx="40" cy="14" r="8" fill="${c}"/>`;
  return '';
}
function hairFront(a, c) {
  switch (a.style) {
    case 'short': return `<path d="M26 36c0-12 7-18 14-18s14 6 14 18c-4-6-9-8-14-8s-10 2-14 8z" fill="${c}"/>`;
    case 'long': case 'bob': return `<path d="M26 38c1-12 7-19 14-19s13 7 14 19c-5-7-9-9-14-9s-9 2-14 9z" fill="${c}"/>`;
    case 'bun': return `<path d="M26 38c1-12 7-18 14-18s13 6 14 18c-5-6-9-8-14-8s-9 2-14 8z" fill="${c}"/>`;
    case 'curly': return `<g fill="${c}"><circle cx="28" cy="29" r="6"/><circle cx="35" cy="23" r="6.500"/><circle cx="45" cy="23" r="6.500"/><circle cx="52" cy="29" r="6"/><circle cx="40" cy="27" r="6"/></g>`;
    case 'cap': return `<path d="M25 36c0-12 7-18 15-18s15 6 15 18z" fill="${c}"/><path d="M25 35h38c3 0 4 3 0 4H25z" fill="${c}"/>`;
    default: return '';
  }
}

export function avatarSvg(key) {
  const a = AVATARS[key];
  if (!a) return '';
  const skin = SKIN[a.skin]; const hair = HAIR[a.hair];
  const cap = a.style === 'cap' ? a.shirt : hair;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" role="img" aria-hidden="true">
    <rect width="80" height="80" fill="${a.bg}"/>
    ${hairBack(a, hair)}
    <path d="M12 82c1-14 12-20 28-20s27 6 28 20z" fill="${a.shirt}"/>
    <rect x="35" y="50" width="10" height="13" rx="4" fill="${skin}"/>
    <ellipse cx="40" cy="38" rx="14" ry="16" fill="${skin}"/>
    ${hairFront(a, cap)}
    <circle cx="34.500" cy="40" r="1.500" fill="#1c1410"/><circle cx="45.500" cy="40" r="1.500" fill="#1c1410"/>
    <path d="M35.500 47c2.500 2.500 6.500 2.500 9 0" fill="none" stroke="#7a3d2a" stroke-width="1.800" stroke-linecap="round"/>
    ${a.glasses ? '<g fill="none" stroke="#1c1410" stroke-width="1.400"><circle cx="34.500" cy="40" r="4.500"/><circle cx="45.500" cy="40" r="4.500"/><path d="M39 40h2"/></g>' : ''}
  </svg>`;
}

const TINTS = [['#dfeeed', '#006768'], ['#fbe3d2', '#a2491a'], ['#e6e9f5', '#3b4a8a'], ['#e2f3ea', '#1d7a4f'], ['#f7e4ea', '#9a2f55'], ['#fdf0d9', '#a96300']];
function tintFor(name = '') { let n = 0; for (const ch of name) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return TINTS[n % TINTS.length]; }

// <span class="avatar"> with the illustration, or initials as the fallback.
export function avatar(user, size = '') {
  const key = user && (user.avatar_key || user.cashier_avatar);
  const name = (user && (user.full_name || user.name || user.cashier)) || '';
  const el = h('span', { class: `avatar ${size}`, title: name });
  if (key && AVATARS[key]) { el.append(fromHtml(avatarSvg(key))); return el; }
  const [bg, fg] = tintFor(name);
  el.style.background = bg; el.style.color = fg; el.textContent = initials(name) || '?';
  return el;
}
export const avatarFor = (name, key, size = '') => avatar({ full_name: name, avatar_key: key }, size);
