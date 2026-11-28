import { api } from '../api.js';
import { h, peso, num, ago, fmtDateTime, toast, openModal, field, input, withIcon, peso$, busy, showFieldErrors, setFieldError, debounce, switchEl, confirmModal } from '../util.js';
import { icon } from '../icons.js';
import { pageHead, card, emptyState, redraw, insightStrip, passwordInput, passwordRules } from '../components.js';
import { avatar, avatarFor, AVATAR_KEYS, avatarSvg } from '../avatars.js';
import { hbars } from '../charts.js';
import { fromHtml } from '../util.js';
import { href, go } from '../router.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export async function list() {
  let q = '';
  const page = h('div', { class: 'stack s24' });
  page.append(pageHead({ title: 'Staff', subtitle: 'Who works at the store and who can sign in.', actions: h('a', { class: 'btn primary', href: href('/staff/new') }, icon('plus', 16), 'Add staff') }));
  const strip = h('div'); page.append(strip);
  const loadStrip = () => api.get('/api/staff/analytics').then((a) => {
    strip.replaceChildren(h('div', { class: 'stack' }, insightStrip([
      { value: `${a.clocked_in} of ${a.can_log_in}`, label: 'clocked in now' }, { value: peso(a.week_total), label: 'team sales, 7 days' }, { value: a.top_seller || '—', label: 'top seller this week' }, { value: peso(a.avg_sale, 2), label: 'average sale' }]),
    h('div', { class: 'grid g2' },
      card(h('div', { class: 'stack s8' }, h('div', { class: 'row', style: { gap: '4px', paddingLeft: '80px' } }, DAYS.map((d) => h('span', { class: 'tiny muted center', style: { flex: 1 } }, d))),
        [['Morning', a.coverage.morning], ['Evening', a.coverage.evening]].map(([label, vals]) => h('div', { class: 'row', style: { gap: '4px' } }, h('span', { class: 'small muted', style: { width: '76px' } }, label),
          vals.map((v) => h('div', { title: `${v} on shift`, style: { flex: 1, height: '30px', borderRadius: '8px', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: '13px', background: v === 0 ? 'var(--bad-bg)' : v === 1 ? 'var(--warn-bg)' : 'var(--chip)', color: v === 0 ? 'var(--bad)' : v === 1 ? 'var(--warn)' : 'var(--teal)' } }, v)))),
        h('p', { class: 'tiny muted' }, 'People scheduled per shift. Red means nobody is covering.')), { title: 'Shift coverage' }),
      card(a.by_cashier.length ? hbars(a.by_cashier.map((c) => ({ label: c.name, value: c.total })), {}) : h('p', { class: 'muted' }, 'No sales yet.'), { title: 'Sales by cashier', subtitle: 'Last 7 days' }))));
  }).catch(() => {});
  loadStrip();

  const box = h('div'); page.append(box);
  async function load() {
    const r = await api.get('/api/staff', { q });
    const search = input({ type: 'search', placeholder: 'Search staff', value: q, 'aria-label': 'Search staff' });
    search.addEventListener('input', debounce(() => { q = search.value; load().then(() => { const i = box.querySelector('input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 250));
    const table = !r.staff.length
      ? emptyState(q ? { art: 'search', title: 'No staff match', text: 'Try another name.' } : { art: 'staff', title: 'No staff yet', text: 'Add your first cashier so they can sign in and ring up sales.', action: h('a', { class: 'btn primary', href: href('/staff/new') }, 'Add staff') })
      : h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Person', 'Role', 'Status', 'Sales today', 'Last sign-in'].map((t, i) => h('th', { class: i === 3 ? 'right' : '' }, t)))),
        h('tbody', null, r.staff.map((s) => h('tr', { class: 'click', onclick: () => go(`/staff/${s.id}`) },
          h('td', null, h('div', { class: 'row' }, avatar(s), h('div', null, h('div', { class: 'bold' }, s.full_name), h('div', { class: 'small muted' }, `@${s.username}`)))),
          h('td', null, s.job_title || 'Cashier', h('div', { class: 'small muted' }, s.station)),
          h('td', null, s.is_active ? h('span', { class: 'badge ok' }, h('i', { class: 'dot' }), s.on_shift ? 'On shift' : 'Can sign in') : h('span', { class: 'badge' }, 'Cannot sign in')),
          h('td', { class: 'right num' }, s.sales_count_today ? [h('b', null, peso(s.sales_today)), h('div', { class: 'tiny muted' }, `${s.sales_count_today} orders`)] : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'muted' }, s.last_login_at ? ago(s.last_login_at) : 'Never'))))));
    redraw(box, h('div', { class: 'stack s12' }, h('div', { class: 'toolbar', style: { marginBottom: 0 } }, h('div', { class: 'search' }, withIcon(icon('search', 18), search)), h('span', { class: 'small muted' }, `${r.counts.active} of ${r.counts.total} can sign in`)), h('div', { class: 'card flush' }, table)));
  }
  await load();
  page.refresh = () => { loadStrip(); return load(); };
  return page;
}

function avatarPicker(initial) {
  let value = initial || '';
  const wrap = h('div', { class: 'avatar-pick' });
  const paint = () => {
    wrap.replaceChildren(h('button', { type: 'button', class: !value ? 'active' : '', 'aria-label': 'Use initials', onclick: () => { value = ''; paint(); } }, h('span', { class: 'avatar' }, 'Aa')),
      ...AVATAR_KEYS.map((k) => h('button', { type: 'button', class: k === value ? 'active' : '', 'aria-label': `Avatar ${k}`, onclick: () => { value = k; paint(); } }, h('span', { class: 'avatar' }, fromHtml(avatarSvg(k))))));
  };
  paint();
  return { node: wrap, get value() { return value; } };
}

export async function form({ params }, panel) {
  const editing = !!params.id;
  const s = editing ? (await api.get(`/api/staff/${params.id}`)).staff : { username: '', full_name: '', email: '', mobile: '', job_title: 'Cashier', station: 'Register 1', daily_goal: 7000, avatar_key: '', is_active: true };
  const f = {
    full_name: input({ value: s.full_name, placeholder: 'e.g. Juan Dela Cruz' }), username: input({ value: s.username, placeholder: 'e.g. juandelacruz', autocomplete: 'off', disabled: editing ? true : null }),
    email: input({ type: 'email', value: s.email || '', placeholder: 'name@example.com' }), mobile: input({ value: s.mobile || '', placeholder: '09XX XXX XXXX' }),
    job_title: input({ value: s.job_title || '', placeholder: 'Cashier, day shift' }), station: input({ value: s.station || '' }), daily_goal: peso$({ value: s.daily_goal }),
  };
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: 'Temporary password' }); const pw2 = passwordInput({ autocomplete: 'new-password', placeholder: 'Type it again' });
  const rules = passwordRules(pw.input);
  const av = avatarPicker(s.avatar_key);
  let canLogin = s.is_active; let mustChange = true;
  const boxes = { full_name: field('Full name', f.full_name), username: field('Username', withIcon(icon('user', 18), f.username), { hint: editing ? 'The username cannot be changed.' : 'Used to sign in. Letters, numbers, dots or dashes.' }),
    email: field('Email', withIcon(icon('mail', 18), f.email), { hint: 'Needed to send a password reset.' }), mobile: field('Mobile number', withIcon(icon('phone', 18), f.mobile)),
    job_title: field('Job title', f.job_title), station: field('Register', f.station), daily_goal: field('Daily sales goal', f.daily_goal), password: field('Password', pw), confirm: field('Confirm password', pw2) };
  const err = h('div', { class: 'alert err hidden', role: 'alert' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save changes' : 'Add staff');

  const values = () => {
    const body = { full_name: f.full_name.value, username: f.username.value, email: f.email.value, mobile: f.mobile.value, job_title: f.job_title.value, station: f.station.value,
      daily_goal: f.daily_goal.querySelector('input').value, avatar_key: av.value };
    if (editing) body.is_active = canLogin; else Object.assign(body, { password: pw.input.value, confirm: pw2.input.value, must_change_password: mustChange });
    return body;
  };
  const invalid = (box, message) => { setFieldError(box, message); panel.revealError(); };
  let saving = false;
  async function submit() {
    if (saving) return;
    err.classList.add('hidden'); showFieldErrors(boxes);
    if (!editing) { if (!rules.ok()) return invalid(boxes.password, 'Follow the password rules below'); if (pw.input.value !== pw2.input.value) return invalid(boxes.confirm, 'Passwords do not match'); }
    saving = true;
    const saved = await busy(save, async () => {
      try { if (editing) await api.put(`/api/staff/${params.id}`, values()); else await api.post('/api/staff', values()); return true; }
      catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(boxes, ex.fields); else { err.textContent = ex.message; err.classList.remove('hidden'); } return false; }
    });
    saving = false;
    if (!saved) return panel.revealError();
    panel.finish();
    toast(editing ? 'Changes saved' : 'Staff added', 'ok');
    panel.refreshBehind();
  }

  const identity = editing ? h('div', { class: 'row', style: { marginBottom: '16px' } }, avatar(s, 'lg'),
    h('div', null, h('b', null, s.full_name), h('div', { class: 'small muted' }, `Last sign-in: ${s.last_login_at ? fmtDateTime(s.last_login_at) : 'never'}`))) : null;
  const loginRow = editing ? h('div', { class: 'opt-row' }, h('div', null, h('b', null, 'Can log in'), h('p', null, 'Turn off to stop them signing in. Their sales history stays.')), switchEl(canLogin, (v) => { canLogin = v; })) : null;

  return {
    title: editing ? s.full_name : 'Add staff',
    subtitle: editing ? `@${s.username}` : 'Create a cashier account.',
    body: [
      card(h('div', null, identity, h('div', { class: 'form-grid' }, boxes.full_name, boxes.username, h('div', { class: 'full' }, boxes.email), boxes.mobile, boxes.job_title, boxes.station, boxes.daily_goal), loginRow), { title: 'Profile' }),
      card(h('div', { class: 'stack' }, h('div', { class: 'small muted' }, 'Pick a picture, or keep their initials.'), av.node), { title: 'Avatar' }),
      editing ? null : card(h('div', { class: 'stack' }, boxes.password, rules.node, boxes.confirm, h('label', { class: 'row s8' }, switchEl(true, (v) => { mustChange = v; }), h('span', null, 'Ask them to choose their own password at first sign-in'))), { title: 'First password' }),
      // these act at once, without the Save button
      editing ? card(h('div', { class: 'row wrap s8' },
        h('button', { type: 'button', class: 'btn', onclick: () => sendReset(s) }, icon('mail', 16), 'Send reset link'),
        h('button', { type: 'button', class: 'btn', onclick: () => tempPassword(s) }, icon('key', 16), 'Create temporary password')), { title: 'Access', subtitle: 'These happen right away, without saving.' }) : null,
    ],
    error: err,
    actions: save,
    onSubmit: submit,
    snapshot: values,
  };
}

async function sendReset(s) {
  try { const r = await api.post(`/api/staff/${s.id}/send-reset`); toast(`Reset code sent to ${r.sent_to}`, 'ok'); }
  catch (ex) { toast(ex.message, 'err'); }
}
async function tempPassword(s) {
  if (!(await confirmModal({ title: 'Create a temporary password?', message: `${s.full_name} will be signed out everywhere and must choose a new password at next sign-in.`, confirmText: 'Create password' }))) return;
  try {
    const r = await api.post(`/api/staff/${s.id}/temp-password`);
    const m = openModal(h('div', null, h('h2', null, 'Temporary password'), h('p', { class: 'muted' }, 'Tell this to the person now. It will not be shown again.'),
      h('div', { class: 'soft-box center', style: { margin: '16px 0', fontSize: '28px', fontWeight: 700, letterSpacing: '.06em', fontFamily: 'ui-monospace, Menlo, monospace' } }, r.temporary_password),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => navigator.clipboard && navigator.clipboard.writeText(r.temporary_password).then(() => toast('Copied')) }, 'Copy'), h('button', { class: 'btn primary', onclick: () => m.close() }, 'Done'))));
  } catch (ex) { toast(ex.message, 'err'); }
}
