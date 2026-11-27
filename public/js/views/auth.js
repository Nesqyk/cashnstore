import { api, ApiError } from '../api.js';
import { h, field, setFieldError, showFieldErrors, input, withIcon, toast, busy } from '../util.js';
import { icon } from '../icons.js';
import { heroArt } from '../illustrations.js';
import { passwordInput, passwordRules } from '../components.js';
import { go, href } from '../router.js';
import { session } from '../state.js';

function authLayout(card) {
  return h('div', { class: 'auth' },
    h('div', { class: 'auth-hero' },
      h('div', { class: 'row' }, h('img', { src: '/assets/logo.svg', width: 44, height: 44, alt: '', style: { borderRadius: '12px' } }), h('b', { style: { fontSize: '20px' } }, 'CashNStore')),
      h('div', null, h('h1', null, 'Sales, stock and GCash in one calm place.'), h('p', null, 'Built for the tindahan counter: ring up customers fast, know what to restock, and see your cash and GCash float at a glance.')),
      heroArt()),
    h('div', { class: 'auth-form' }, h('div', { class: 'auth-card' }, card)));
}

async function lateAfterLogin(user) { const m = await import('../main.js'); return m.afterLogin(user); }

export function login() {
  const user = input({ type: 'text', autocomplete: 'username', placeholder: 'Your username', autofocus: true });
  const pw = passwordInput({ autocomplete: 'current-password', placeholder: 'Your password' });
  const uBox = field('Username', withIcon(icon('user', 18), user));
  const pBox = field('Password', pw);
  const err = h('div', { class: 'alert err hidden', role: 'alert' });
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'stack', novalidate: true },
    uBox, pBox,
    h('div', { class: 'row between' }, h('span'), h('a', { href: href('/forgot') }, 'Forgot password?')),
    err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.add('hidden'); showFieldErrors({ username: uBox, password: pBox });
    if (!user.value.trim()) return setFieldError(uBox, 'Enter your username');
    if (!pw.input.value) return setFieldError(pBox, 'Enter your password');
    await busy(btn, async () => {
      btn.textContent = 'Signing in…';
      try {
        const r = await api.post('/api/auth/login', { username: user.value.trim(), password: pw.input.value });
        await lateAfterLogin(r.user);
      } catch (ex) {
        err.textContent = ex.message; err.classList.remove('hidden');
        if (ex.fields) showFieldErrors({ username: uBox, password: pBox }, ex.fields);
      }
    });
  });
  return authLayout(h('div', null, h('h1', null, 'Welcome back'), h('p', null, 'Sign in to open the register.'), form,
    h('p', { class: 'small muted', style: { marginTop: '22px' } }, 'No account yet? Ask the owner to add you under Staff.')));
}

export function forgot() {
  const email = input({ type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
  const box = field('Email', withIcon(icon('mail', 18), email), { hint: 'We will send a 6-digit code to this email.' });
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Send code');
  const form = h('form', { class: 'stack', novalidate: true }, box, btn, h('a', { class: 'btn ghost block', href: href('/login') }, icon('arrowLeft', 16), 'Back to sign in'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); setFieldError(box, '');
    if (!email.value.trim()) return setFieldError(box, 'Enter your email');
    await busy(btn, async () => {
      try { await api.post('/api/auth/forgot', { email: email.value.trim() }); go(`/reset?email=${encodeURIComponent(email.value.trim())}`); toast('If that email has an account, a code is on its way.'); }
      catch (ex) { setFieldError(box, ex.fields?.email || ex.message); }
    });
  });
  return authLayout(h('div', null, h('h1', null, 'Forgot your password?'), h('p', null, 'No problem. We will email you a code to set a new one.'), form));
}

export function reset({ query }) {
  const email = input({ type: 'email', value: query.email || '', autocomplete: 'email' });
  const code = input({ inputmode: 'numeric', maxlength: 6, placeholder: '6-digit code', autocomplete: 'one-time-code' });
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: 'New password' });
  const pw2 = passwordInput({ autocomplete: 'new-password', placeholder: 'Type it again' });
  const rules = passwordRules(pw.input);
  const boxes = { email: field('Email', email), code: field('Code', code), password: field('New password', pw), confirm: field('Confirm new password', pw2) };
  const err = h('div', { class: 'alert err hidden', role: 'alert' });
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Save new password');
  const form = h('form', { class: 'stack', novalidate: true }, boxes.email, boxes.code, boxes.password, rules.node, boxes.confirm, err, btn,
    h('a', { class: 'btn ghost block', href: href('/forgot') }, 'Send a new code'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.classList.add('hidden'); showFieldErrors(boxes);
    if (!rules.ok()) return setFieldError(boxes.password, 'Follow the password rules below');
    if (pw.input.value !== pw2.input.value) return setFieldError(boxes.confirm, 'Passwords do not match');
    await busy(btn, async () => {
      try {
        await api.post('/api/auth/reset', { email: email.value.trim(), code: code.value.trim(), password: pw.input.value });
        toast('Password changed. Please sign in.', 'ok'); go('/login');
      } catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(boxes, ex.fields); else { err.textContent = ex.message; err.classList.remove('hidden'); } }
    });
  });
  return authLayout(h('div', null, h('h1', null, 'Set a new password'), h('p', null, 'Enter the code from your email.'), form));
}

// Shown after a temporary password or a reset by the owner.
export function forcePassword() {
  const cur = passwordInput({ autocomplete: 'current-password', placeholder: 'Temporary password' });
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: 'New password' });
  const pw2 = passwordInput({ autocomplete: 'new-password', placeholder: 'Type it again' });
  const rules = passwordRules(pw.input, { symbol: true });
  const boxes = { current: field('Temporary password', cur), next: field('New password', pw), confirm: field('Confirm new password', pw2) };
  const err = h('div', { class: 'alert err hidden', role: 'alert' });
  const btn = h('button', { class: 'btn primary lg block', type: 'submit' }, 'Save and continue');
  const form = h('form', { class: 'stack', novalidate: true }, boxes.current, boxes.next, rules.node, boxes.confirm, err, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.classList.add('hidden'); showFieldErrors(boxes);
    if (!rules.ok()) return setFieldError(boxes.next, 'Follow the password rules below');
    if (pw.input.value !== pw2.input.value) return setFieldError(boxes.confirm, 'Passwords do not match');
    await busy(btn, async () => {
      try {
        await api.post('/api/auth/change-password', { current: cur.input.value, next: pw.input.value, confirm: pw2.input.value });
        session.user.must_change_password = false; toast('Password updated', 'ok'); go('/');
      } catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(boxes, ex.fields); else { err.textContent = ex.message; err.classList.remove('hidden'); } }
    });
  });
  return authLayout(h('div', null, h('h1', null, 'Choose your own password'), h('p', null, 'For your safety, replace the temporary password before you continue.'), form));
}
