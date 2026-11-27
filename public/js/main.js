import { api, setUnauthorizedHandler } from './api.js';
import { h, clear, spinnerBlock, toast } from './util.js';
import { icon } from './icons.js';
import { avatar } from './avatars.js';
import { session, can, canAny, isOwner } from './state.js';
import { compile, match, parseHash, go, href } from './router.js';

const app = document.getElementById('app');

// ---- route table ----------------------------------------------------------------------------------
// `perm`: any one of these permissions is enough. `auth: false` marks the sign-in screens.
const ROUTES = compile([
  { path: '/login', auth: false, load: () => import('./views/auth.js').then((m) => m.login) },
  { path: '/forgot', auth: false, load: () => import('./views/auth.js').then((m) => m.forgot) },
  { path: '/reset', auth: false, load: () => import('./views/auth.js').then((m) => m.reset) },
  { path: '/new-password', load: () => import('./views/auth.js').then((m) => m.forcePassword), bare: true },
  { path: '/', load: () => import('./views/dashboard.js').then((m) => m.default), nav: 'dashboard' },
  { path: '/pos', perm: ['pos.sell'], load: () => import('./views/pos.js').then((m) => m.default), nav: 'pos' },
  { path: '/products', perm: ['products.view'], load: () => import('./views/products.js').then((m) => m.list), nav: 'products' },
  { path: '/products/new', perm: ['products.manage'], load: () => import('./views/products.js').then((m) => m.form), nav: 'products' },
  { path: '/products/:id/edit', perm: ['products.manage'], load: () => import('./views/products.js').then((m) => m.form), nav: 'products' },
  { path: '/products/:id/restock', perm: ['inventory.restock'], load: () => import('./views/products.js').then((m) => m.restock), nav: 'products' },
  { path: '/inventory', perm: ['inventory.view'], load: () => import('./views/inventory.js').then((m) => m.default), nav: 'inventory' },
  { path: '/sales', perm: ['sales.view_own', 'sales.view_all'], load: () => import('./views/sales.js').then((m) => m.list), nav: 'sales' },
  { path: '/sales/:id', perm: ['sales.view_own', 'sales.view_all'], load: () => import('./views/sales.js').then((m) => m.detail), nav: 'sales' },
  { path: '/gcash', perm: ['gcash.view'], load: () => import('./views/gcash.js').then((m) => m.list), nav: 'gcash' },
  { path: '/gcash/cash-in', perm: ['gcash.transact'], load: () => import('./views/gcash.js').then((m) => m.cashIn), nav: 'gcash' },
  { path: '/gcash/cash-out', perm: ['gcash.transact'], load: () => import('./views/gcash.js').then((m) => m.cashOut), nav: 'gcash' },
  { path: '/gcash/:id', perm: ['gcash.view'], load: () => import('./views/gcash.js').then((m) => m.detail), nav: 'gcash' },
  { path: '/staff', perm: ['staff.manage'], load: () => import('./views/staff.js').then((m) => m.list), nav: 'staff' },
  { path: '/staff/new', perm: ['staff.manage'], load: () => import('./views/staff.js').then((m) => m.form), nav: 'staff' },
  { path: '/staff/:id', perm: ['staff.manage'], load: () => import('./views/staff.js').then((m) => m.form), nav: 'staff' },
  { path: '/reports', perm: ['reports.view'], load: () => import('./views/reports.js').then((m) => m.overview), nav: 'reports' },
  { path: '/reports/:kind', perm: ['reports.view'], load: () => import('./views/reports.js').then((m) => m.detail), nav: 'reports' },
  { path: '/settings', load: () => import('./views/settings.js').then((m) => m.default), nav: 'settings' },
  { path: '/settings/:tab', load: () => import('./views/settings.js').then((m) => m.default), nav: 'settings' },
]);

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', to: '/', perm: null },
  { id: 'pos', label: 'Point of sale', icon: 'cart', to: '/pos', perm: ['pos.sell'] },
  { id: 'products', label: 'Products', icon: 'box', to: '/products', perm: ['products.view'] },
  { id: 'inventory', label: 'Inventory', icon: 'clipboard', to: '/inventory', perm: ['inventory.view'] },
  { id: 'sales', label: 'Sales', icon: 'receipt', to: '/sales', perm: ['sales.view_own', 'sales.view_all'] },
  { id: 'gcash', label: 'GCash cash in/out', icon: 'wallet', to: '/gcash', perm: ['gcash.view'] },
  { sep: 'Manage' },
  { id: 'staff', label: 'Staff', icon: 'users', to: '/staff', perm: ['staff.manage'] },
  { id: 'reports', label: 'Reports', icon: 'chart', to: '/reports', perm: ['reports.view'] },
  { id: 'settings', label: 'Settings', icon: 'settings', to: '/settings', perm: ['settings.manage'] },
];

// ---- shell ---------------------------------------------------------------------------------------------
function shell(activeNav, content) {
  const items = NAV.filter((n) => n.sep ? true : !n.perm || canAny(...n.perm));
  // Drop a section heading if nothing is listed under it
  const visible = items.filter((n, i) => !n.sep || (items[i + 1] && !items[i + 1].sep));
  const u = session.user;
  return h('div', { class: 'shell' },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, h('img', { src: '/assets/logo.svg', alt: '' }),
        h('div', null, h('b', null, 'CashNStore'), h('span', null, session.store ? session.store.store_name.split(' ').slice(0, 3).join(' ') : ''))),
      h('nav', { class: 'nav', 'aria-label': 'Main' }, visible.map((n) => n.sep
        ? h('div', { class: 'sep' }, n.sep)
        : h('a', { href: href(n.to), class: n.id === activeNav ? 'active' : '', 'aria-current': n.id === activeNav ? 'page' : null }, icon(n.icon, 20), n.label))),
      h('div', { class: 'me' },
        h('a', { href: href('/settings/account'), title: 'My account' }, avatar(u)),
        h('div', { class: 'who' }, h('b', null, u.full_name), h('span', null, u.role_name)),
        h('button', { class: 'icon-btn', title: 'Sign out', 'aria-label': 'Sign out', onclick: signOut }, icon('logout', 18)))),
    h('main', { class: 'main', id: 'main' }, content));
}

async function signOut() {
  try { await api.post('/api/auth/logout'); } catch (_) { /* already signed out */ }
  session.user = null; session.store = null;
  go('/login');
}

// ---- rendering ------------------------------------------------------------------------------------------
let renderToken = 0;
async function render() {
  const token = ++renderToken;
  document.getElementById('modal-root').replaceChildren();   // close any open dialog when the page changes
  const { path, query } = parseHash();
  const found = match(ROUTES, path);

  if (!found) { app.replaceChildren(shellOrBare('', notFound())); return; }
  const { route, params } = found;

  if (route.auth !== false && !session.user) { go('/login'); return; }
  if (route.auth === false && session.user) { go('/'); return; }
  if (session.user && session.user.must_change_password && path !== '/new-password') { go('/new-password'); return; }
  if (route.perm && !canAny(...route.perm)) {
    app.replaceChildren(shellOrBare(route.nav, forbidden()));
    return;
  }

  const bareScreen = route.auth === false || route.bare;
  if (bareScreen) app.replaceChildren(spinnerBlock());
  else {
    // keep the sidebar while the screen loads
    const main = document.getElementById('main');
    if (main && app.querySelector('.shell')) {
      app.querySelector('.nav').replaceWith(shell(route.nav, h('div')).querySelector('.nav'));
      main.replaceChildren(spinnerBlock());
    } else app.replaceChildren(shell(route.nav, spinnerBlock()));
  }

  let node;
  try {
    const view = await route.load();
    node = await view({ params, query, user: session.user, path });
  } catch (err) {
    console.error(err);
    node = errorBox(err);
  }
  if (token !== renderToken) return;                       // user navigated away meanwhile
  if (bareScreen) app.replaceChildren(node);
  else { app.replaceChildren(shell(route.nav, node)); window.scrollTo(0, 0); }
  document.title = `${titleFor(route.nav)} · CashNStore`;
}

const titleFor = (id) => (NAV.find((n) => n.id === id) || {}).label || 'CashNStore';
const shellOrBare = (nav, node) => (session.user ? shell(nav, node) : node);

const notFound = () => h('div', { class: 'empty' }, h('h3', null, 'Page not found'), h('p', null, 'That page does not exist.'), h('a', { class: 'btn primary', href: href('/') }, 'Back to dashboard'));
const forbidden = () => h('div', { class: 'empty' }, icon('lock', 40), h('h3', null, 'You do not have access to this page'), h('p', null, 'Ask the owner if you need it.'), h('a', { class: 'btn primary', href: href('/') }, 'Back to dashboard'));
const errorBox = (err) => h('div', { class: 'empty' }, icon('alert', 40), h('h3', null, 'Could not load this page'),
  h('p', null, err && err.message ? err.message : 'Something went wrong.'), h('button', { class: 'btn primary', onclick: () => render() }, 'Try again'));

// ---- start ----------------------------------------------------------------------------------------------
setUnauthorizedHandler(() => {
  if (session.user) { session.user = null; toast('You were signed out. Please sign in again.', 'err'); go('/login'); }
});

window.addEventListener('hashchange', render);

(async function boot() {
  app.replaceChildren(spinnerBlock());
  try {
    const me = await api.get('/api/auth/me');
    session.user = me.user;
    if (me.user) { try { session.store = (await api.get('/api/settings/store')).store; } catch (_) { session.store = { store_name: 'CashNStore' }; } }
  } catch (err) {
    app.replaceChildren(errorBox(err));
    return;
  }
  render();
})();

// Other screens call this after sign-in so the shell has the user and store.
export async function afterLogin(user) {
  session.user = user;
  try { session.store = (await api.get('/api/settings/store')).store; } catch (_) { session.store = { store_name: 'CashNStore' }; }
  go(user.must_change_password ? '/new-password' : '/');
}
export { signOut };
