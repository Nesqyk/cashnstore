// Friendly empty-state pictures, drawn as SVG with the app colours.
import { fromHtml } from './util.js';

const T = '#006768', T2 = '#4f9d9a', T3 = '#bcdad7', CH = '#dfeeed', OR = '#d9692a', SF = '#f1f5f4', LN = '#cdd8d6';

const ART = {
  // No sales yet: a register with an empty receipt
  sales: `<rect x="40" y="96" width="140" height="22" rx="6" fill="${CH}"/><rect x="52" y="52" width="116" height="52" rx="10" fill="${T}"/><rect x="62" y="62" width="64" height="20" rx="4" fill="${T3}"/>
    <circle cx="144" cy="74" r="6" fill="${OR}"/><rect x="62" y="88" width="96" height="6" rx="3" fill="${T2}"/>
    <path d="M150 20h38v62l-6-4-6 4-6-4-6 4-6-4-6 4z" fill="#fff" stroke="${LN}" stroke-width="2"/><path d="M158 34h22M158 44h16M158 54h20" stroke="${LN}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="36" cy="40" r="3" fill="${T3}"/><circle cx="196" cy="108" r="4" fill="${CH}"/>`,
  // No products: open box
  products: `<path d="M50 62l60-24 60 24v54l-60 24-60-24z" fill="${CH}"/><path d="M50 62l60 24 60-24" fill="none" stroke="${T2}" stroke-width="3" stroke-linejoin="round"/><path d="M110 86v54" stroke="${T2}" stroke-width="3"/>
    <path d="M50 62L30 40l50-14 30 12zM170 62l20-22-50-14-30 12z" fill="${T3}" stroke="${T2}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="110" cy="22" r="9" fill="${OR}"/><path d="M110 17v10M105 22h10" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/>`,
  // Nothing low on stock: shelf with a check
  stock: `<rect x="34" y="112" width="152" height="8" rx="4" fill="${T2}"/><rect x="46" y="70" width="34" height="42" rx="6" fill="${T3}"/><rect x="90" y="56" width="34" height="56" rx="6" fill="${CH}" stroke="${T2}" stroke-width="2"/>
    <rect x="134" y="80" width="34" height="32" rx="6" fill="${T3}"/><circle cx="165" cy="38" r="20" fill="${T}"/><path d="M155 38l7 7 13-14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  // No GCash activity: phone with coin
  gcash: `<rect x="74" y="20" width="72" height="116" rx="14" fill="${T}"/><rect x="82" y="34" width="56" height="84" rx="6" fill="#fff"/><circle cx="110" cy="62" r="14" fill="${CH}"/><path d="M110 54v16M105 58c.8-2 2.700-3 5-3s4.200 1 5 3" fill="none" stroke="${T}" stroke-width="2.500" stroke-linecap="round"/>
    <rect x="92" y="86" width="36" height="6" rx="3" fill="${T3}"/><rect x="98" y="98" width="24" height="6" rx="3" fill="${CH}"/><circle cx="168" cy="52" r="16" fill="${OR}"/><path d="M168 44v16M163 49c1-2 3-3 5-3s4 1 5 3" fill="none" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/>
    <path d="M150 74l12-8M150 74l12 8" stroke="${T2}" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  // No staff
  staff: `<circle cx="110" cy="58" r="22" fill="${T3}"/><path d="M66 128c2-26 20-38 44-38s42 12 44 38z" fill="${T}"/><circle cx="62" cy="76" r="14" fill="${CH}"/><path d="M34 128c1-16 12-24 28-24" fill="none" stroke="${T2}" stroke-width="10" stroke-linecap="round" opacity=".5"/>
    <circle cx="160" cy="76" r="14" fill="${CH}"/><path d="M186 128c-1-16-12-24-26-24" fill="none" stroke="${T2}" stroke-width="10" stroke-linecap="round" opacity=".5"/><circle cx="176" cy="32" r="14" fill="${OR}"/><path d="M176 25v14M169 32h14" stroke="#fff" stroke-width="2.500" stroke-linecap="round"/>`,
  // Search found nothing
  search: `<circle cx="100" cy="68" r="34" fill="${CH}" stroke="${T}" stroke-width="7"/><path d="M126 94l34 34" stroke="${T}" stroke-width="9" stroke-linecap="round"/><path d="M86 60h28M86 76h18" stroke="${T2}" stroke-width="5" stroke-linecap="round"/><circle cx="172" cy="34" r="5" fill="${OR}"/><circle cx="42" cy="110" r="4" fill="${T3}"/>`,
  // Analytics need data first
  chart: `<rect x="44" y="84" width="26" height="46" rx="5" fill="${T3}"/><rect x="82" y="58" width="26" height="72" rx="5" fill="${T2}"/><rect x="120" y="74" width="26" height="56" rx="5" fill="${T3}"/><rect x="158" y="38" width="26" height="92" rx="5" fill="${T}"/>
    <path d="M38 134h152" stroke="${LN}" stroke-width="3" stroke-linecap="round"/><circle cx="171" cy="22" r="7" fill="${OR}"/>`,
};

export function illustration(kind) {
  return fromHtml(`<svg class="ill" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 150" role="img" aria-hidden="true">${ART[kind] || ART.search}</svg>`);
}
export const ILLUSTRATION_KINDS = Object.keys(ART);

// The hero picture on the sign-in screen (our own drawing of a tindahan storefront).
export function heroArt() {
  return fromHtml(`<svg class="art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" aria-hidden="true">
    <rect x="40" y="150" width="400" height="200" rx="10" fill="#0d7b7c"/><rect x="60" y="190" width="360" height="160" fill="#085c5d"/>
    <path d="M30 150l24-70h372l24 70z" fill="#d9692a"/>
    <g>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${54 + i * 46.5} 80h46.500l-0 70h-46.500z" fill="${i % 2 ? '#fff' : '#f2b48c'}" opacity=".95"/>`).join('')}</g>
    <path d="M30 150a30 22 0 0 0 60 0 30 22 0 0 0 60 0 30 22 0 0 0 60 0 30 22 0 0 0 60 0 30 22 0 0 0 60 0 30 22 0 0 0 60 0 30 22 0 0 0 60 0 30 22 0 0 0 60 0z" fill="#fff" opacity=".95"/>
    <rect x="90" y="210" width="130" height="84" rx="8" fill="#bcdad7"/><rect x="100" y="220" width="110" height="64" rx="4" fill="#dfeeed"/>
    <g fill="#4f9d9a"><rect x="106" y="226" width="22" height="26" rx="3"/><rect x="134" y="232" width="22" height="20" rx="3"/><rect x="162" y="224" width="22" height="28" rx="3"/><rect x="186" y="236" width="18" height="16" rx="3"/></g>
    <rect x="100" y="256" width="110" height="5" fill="#006768"/>
    <rect x="262" y="210" width="130" height="140" rx="6" fill="#4f9d9a"/><rect x="274" y="222" width="106" height="64" rx="4" fill="#fff"/>
    <text x="327" y="252" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-weight="700" font-size="22" fill="#006768">BUKAS</text><text x="327" y="272" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="12" fill="#5a6967">Open</text>
    <rect x="290" y="300" width="74" height="50" rx="4" fill="#006768"/><circle cx="352" cy="326" r="3" fill="#bcdad7"/>
  </svg>`);
}
