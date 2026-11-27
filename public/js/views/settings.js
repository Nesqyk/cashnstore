import { api } from '../api.js';
import { h, peso, ago, fmtDateTime, toast, openModal, field, input, withIcon, peso$, busy, showFieldErrors, setFieldError, switchEl, fromHtml } from '../util.js';
import { icon } from '../icons.js';
import { session, can, isOwner } from '../state.js';
import { pageHead, card, tabs, passwordInput, passwordRules } from '../components.js';
import { AVATAR_KEYS, avatarSvg, avatar } from '../avatars.js';
import { go } from '../router.js';

export default async function settings({ params }) {
  const owner = can('settings.manage');
  const available = [...(owner ? [{ value: 'general', label: 'General' }] : []), { value: 'account', label: 'Account' }, { value: 'security', label: 'Security' }];
  const tab = available.some((t) => t.value === params.tab) ? params.tab : available[0].value;
  const body = h('div', { class: 'stack' });
  const view = { general: general, account, security }[tab];
  body.append(await view());
  return h('div', { class: 'stack' }, pageHead({ title: 'Settings', subtitle: owner ? 'Your store, your account and how people sign in.' : 'Your account and sign-in.' }),
    tabs(available, tab, (v) => go(`/settings/${v}`)), body);
}

const row = (title, text, control) => h('div', { class: 'opt-row' }, h('div', null, h('b', null, title), text ? h('p', null, text) : null), control);

// ---- General --------------------------------------------------------------------------------------------------
async function general() {
  const { store: s } = await api.get('/api/settings/store');
  const f = {
    store_name: input({ value: s.store_name }), address: input({ value: s.address }), phone: input({ value: s.phone }), email: input({ type: 'email', value: s.email }), tin: input({ value: s.tin }),
    receipt_message: h('textarea', { class: 'input', maxlength: 160 }, s.receipt_message), logo_url: input({ value: s.logo_url || '', placeholder: 'https://… (optional)' }),
    discount_percent: input({ type: 'number', min: 0, max: 100, step: '0.01', value: s.discount_percent }), gcash_fee_percent: input({ type: 'number', min: 0, max: 20, step: '0.01', value: s.gcash_fee_percent }),
    gcash_min_fee: peso$({ value: s.gcash_min_fee }), gcash_min_float: peso$({ value: s.gcash_min_float }), gcash_target_float: peso$({ value: s.gcash_target_float }),
  };
  f.receipt_message.value = s.receipt_message;
  const val = (k) => (f[k].querySelector ? (f[k].querySelector('input') || f[k]).value : f[k].value);
  const boxes = {
    store_name: field('Store name', f.store_name), address: field('Address', f.address), phone: field('Phone', f.phone), email: field('Email', f.email), tin: field('TIN', f.tin),
    receipt_message: field('Message at the bottom of receipts', f.receipt_message), logo_url: field('Logo link', f.logo_url, { hint: 'Paste a link to your logo. Upload is not set up yet.' }),
    discount_percent: field('Senior / PWD discount (%)', f.discount_percent), gcash_fee_percent: field('GCash fee (%)', f.gcash_fee_percent), gcash_min_fee: field('Minimum GCash fee', f.gcash_min_fee),
    gcash_min_float: field('Warn me when GCash float is below', f.gcash_min_float), gcash_target_float: field('Target GCash float', f.gcash_target_float),
  };
  const err = h('div', { class: 'alert err hidden' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save changes');
  const formEl = h('form', { class: 'stack', novalidate: true },
    card(h('div', { class: 'form-grid' }, h('div', { class: 'full' }, boxes.store_name), h('div', { class: 'full' }, boxes.address), boxes.phone, boxes.email, boxes.tin, h('div', { class: 'full' }, boxes.receipt_message), h('div', { class: 'full' }, boxes.logo_url)), { title: 'Store information', subtitle: 'Printed on every receipt.' }),
    card(h('div', { class: 'form-grid' }, boxes.discount_percent, h('span'), boxes.gcash_fee_percent, boxes.gcash_min_fee, boxes.gcash_min_float, boxes.gcash_target_float), { title: 'Discounts and GCash', subtitle: 'The fee is the percent of the amount, never less than the minimum.' }), err,
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, save));
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault(); err.classList.add('hidden'); showFieldErrors(boxes);
    const body = Object.fromEntries(Object.keys(f).map((k) => [k, val(k)]));
    await busy(save, async () => {
      try { await api.put('/api/settings/store', body); session.store = { ...session.store, ...(await api.get('/api/settings/store')).store }; toast('Settings saved', 'ok'); }
      catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(boxes, ex.fields); else { err.textContent = ex.message; err.classList.remove('hidden'); } }
    });
  });
  return formEl;
}

// ---- Account --------------------------------------------------------------------------------------------------
async function account() {
  const { account: a } = await api.get('/api/settings/account');
  let key = a.avatar_key || ''; let notify = a.notify_daily_summary; let askPin = a.ask_pin_when_short;
  const f = { full_name: input({ value: a.full_name }), email: input({ type: 'email', value: a.email || '' }), mobile: input({ value: a.mobile || '' }) };
  const boxes = { full_name: field('Full name', f.full_name), email: field('Email', withIcon(icon('mail', 18), f.email)), mobile: field('Mobile number', withIcon(icon('phone', 18), f.mobile)) };
  const pick = h('div', { class: 'avatar-pick' });
  const paint = () => pick.replaceChildren(h('button', { type: 'button', class: !key ? 'active' : '', onclick: () => { key = ''; paint(); } }, avatar({ full_name: a.full_name }, '')),
    ...AVATAR_KEYS.map((k) => h('button', { type: 'button', class: k === key ? 'active' : '', 'aria-label': `Avatar ${k}`, onclick: () => { key = k; paint(); } }, h('span', { class: 'avatar' }, fromHtml(avatarSvg(k))))));
  paint();
  const err = h('div', { class: 'alert err hidden' }); const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save changes');
  const formEl = h('form', { class: 'stack', novalidate: true },
    card(h('div', { class: 'stack' }, h('div', { class: 'row' }, avatar({ full_name: a.full_name, avatar_key: a.avatar_key }, 'lg'), h('div', null, h('b', null, a.full_name), h('div', { class: 'small muted' }, `@${a.username} · ${session.user.role_name}`))), h('div', { class: 'label' }, 'Choose your picture'), pick), { title: 'Profile' }),
    card(h('div', { class: 'form-grid' }, h('div', { class: 'full' }, boxes.full_name), boxes.email, boxes.mobile), { title: 'Contact' }),
    card(h('div', null, row('Daily summary', 'Get a short summary of sales when the day ends.', switchEl(notify, (v) => { notify = v; })), row('Ask for a PIN when the drawer is short', 'Helps catch counting mistakes early.', switchEl(askPin, (v) => { askPin = v; }))), { title: 'Preferences' }), err,
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, save));
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault(); err.classList.add('hidden'); showFieldErrors(boxes);
    await busy(save, async () => {
      try { await api.put('/api/settings/account', { full_name: f.full_name.value, email: f.email.value, mobile: f.mobile.value, avatar_key: key, notify_daily_summary: notify, ask_pin_when_short: askPin });
        Object.assign(session.user, { full_name: f.full_name.value, avatar_key: key || null, email: f.email.value }); toast('Account saved', 'ok'); go('/settings/account'); }
      catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(boxes, ex.fields); else { err.textContent = ex.message; err.classList.remove('hidden'); } }
    });
  });
  return formEl;
}

// ---- Security --------------------------------------------------------------------------------------------------
function passwordModal(title, helper, onSave) {
  const pw = passwordInput({ autocomplete: 'current-password', placeholder: 'Your password' }); const box = field('Your password', pw);
  const btn = h('button', { class: 'btn primary' }, 'Confirm');
  const m = openModal(h('div', null, h('h2', null, title), h('p', { class: 'muted' }, helper), h('div', { style: { marginTop: '14px' } }, box), h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), btn)));
  btn.addEventListener('click', () => busy(btn, async () => { try { await onSave(pw.input.value); m.close(); } catch (ex) { setFieldError(box, ex.fields?.password || ex.message); } }));
}

async function security() {
  const blocks = [];
  // change password
  const cur = passwordInput({ autocomplete: 'current-password' }); const nw = passwordInput({ autocomplete: 'new-password' }); const nw2 = passwordInput({ autocomplete: 'new-password' });
  const rules = passwordRules(nw.input, { symbol: true });
  const pb = { current: field('Current password', cur), next: field('New password', nw), confirm: field('Confirm new password', nw2) };
  const perr = h('div', { class: 'alert err hidden' }); const psave = h('button', { class: 'btn primary', type: 'submit' }, 'Change password');
  const pform = h('form', { class: 'stack', novalidate: true }, pb.current, pb.next, rules.node, pb.confirm, perr, h('div', null, psave));
  pform.addEventListener('submit', async (e) => {
    e.preventDefault(); perr.classList.add('hidden'); showFieldErrors(pb);
    if (!rules.ok()) return setFieldError(pb.next, 'Follow the password rules below');
    if (nw.input.value !== nw2.input.value) return setFieldError(pb.confirm, 'Passwords do not match');
    await busy(psave, async () => {
      try { await api.post('/api/auth/change-password', { current: cur.input.value, next: nw.input.value, confirm: nw2.input.value }); toast('Password changed. Other devices were signed out.', 'ok'); pform.reset(); }
      catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(pb, ex.fields); else { perr.textContent = ex.message; perr.classList.remove('hidden'); } }
    });
  });
  blocks.push(card(pform, { title: 'Change password', subtitle: 'Use at least 8 characters with a capital letter, a number and a symbol.' }));

  if (can('settings.manage')) {
    const { store } = await api.get('/api/settings/store');
    let hasPin = store.has_owner_pin; let two = store.two_step_enabled;
    const pinStatus = h('span', { class: `badge ${hasPin ? 'ok' : 'warn'}` }, hasPin ? 'PIN is set' : 'No PIN yet');
    const pinBtn = h('button', { class: 'btn', onclick: () => {
      const pin = input({ type: 'password', inputmode: 'numeric', maxlength: 4, placeholder: '4 digits', autocomplete: 'off' }); const pbx = field('New 4-digit PIN', pin);
      const cbtn = h('button', { class: 'btn primary' }, 'Save PIN'); const pw = passwordInput({ autocomplete: 'current-password' }); const wbx = field('Your password', pw);
      const m = openModal(h('div', null, h('h2', null, hasPin ? 'Change owner PIN' : 'Set owner PIN'), h('p', { class: 'muted' }, 'The PIN is asked for when someone issues a refund.'), h('div', { class: 'stack', style: { marginTop: '14px' } }, pbx, wbx), h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), cbtn)));
      cbtn.addEventListener('click', () => busy(cbtn, async () => { showFieldErrors({ pin: pbx, password: wbx });
        try { await api.post('/api/settings/owner-pin', { pin: pin.value, password: pw.input.value }); hasPin = true; session.store.has_owner_pin = true; m.close(); toast('Owner PIN saved', 'ok'); go('/settings/security'); }
        catch (ex) { showFieldErrors({ pin: pbx, password: wbx }, ex.fields || { pin: ex.message }); } }));
    } }, hasPin ? 'Change PIN' : 'Set PIN');
    const twoSw = switchEl(two, (v) => { two = v; passwordModal('Confirm your password', 'Two-step login is saved as a setting only for now.', async (pw) => { await api.post('/api/settings/two-step', { enabled: v, password: pw }); toast(v ? 'Two-step login turned on' : 'Two-step login turned off', 'ok'); }); });
    blocks.push(card(h('div', null,
      row('Owner PIN', 'A 4-digit PIN that approves refunds.', h('div', { class: 'row' }, pinStatus, pinBtn)),
      row('Two-step login', 'Ask for a code at sign-in. Not active yet: no SMS or email service is connected, so sign-in still needs only your password.', twoSw)), { title: 'Protect the store' }));
  }

  // devices
  const devices = h('div'); 
  async function loadDevices() {
    const { sessions } = await api.get('/api/settings/sessions');
    devices.replaceChildren(h('div', null, sessions.map((s) => h('div', { class: 'opt-row' }, h('div', { class: 'row' }, icon('monitor', 22), h('div', null, h('b', null, s.device, s.current ? h('span', { class: 'badge teal', style: { marginLeft: '8px' } }, 'This device') : null), h('p', null, `${s.ip || ''}${s.last_seen ? ` · active ${ago(s.last_seen)}` : ''}`))),
      s.current ? null : h('button', { class: 'btn sm', onclick: async () => { try { await api.del(`/api/settings/sessions/${s.id}`); toast('Device signed out', 'ok'); loadDevices(); } catch (ex) { toast(ex.message, 'err'); } } }, 'Sign out'))),
      sessions.length > 1 ? h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn', onclick: async () => { await api.post('/api/settings/sessions/sign-out-others'); toast('Signed out of other devices', 'ok'); loadDevices(); } }, 'Sign out of all other devices')) : null));
  }
  await loadDevices();
  blocks.push(card(devices, { title: 'Where you are signed in' }));
  return h('div', { class: 'stack' }, blocks);
}
