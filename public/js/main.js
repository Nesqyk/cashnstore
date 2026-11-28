import { api, setUnauthorizedHandler } from './api.js';
import { h, spinnerBlock, toast, closeAllModals, stillThere } from './util.js';
import { icon } from './icons.js';
import { avatar } from './avatars.js';
import { session, can, canAny, isOwner } from './state.js';
import { compile, match, parseHash, go, href, currentPath, entryState, setEntryState, watchHistory, travel, rewrite, replaceWith, insertUnder } from './router.js';
import { createSidePanel } from './panel.js';

const app = document.getElementById('app');

// ---- route table ----------------------------------------------------------------------------------
// `perm`: any one of these permissions is enough. `auth: false` marks the sign-in screens.
// `panel` marks a route that opens in the side panel. It names the list shown behind it when the URL is opened directly.
const ROUTES = compile([
  { path: '/login', auth: false, load: () => import('./views/auth.js').then((m) => m.login) },
  { path: '/forgot', auth: false, load: () => import('./views/auth.js').then((m) => m.forgot) },
  { path: '/reset', auth: false, load: () => import('./views/auth.js').then((m) => m.reset) },
  { path: '/new-password', load: () => import('./views/auth.js').then((m) => m.forcePassword), bare: true },
  { path: '/', load: () => import('./views/dashboard.js').then((m) => m.default), nav: 'dashboard' },
  { path: '/pos', perm: ['pos.sell'], load: () => import('./views/pos.js').then((m) => m.default), nav: 'pos' },
  { path: '/products', perm: ['products.view'], load: () => import('./views/products.js').then((m) => m.list), nav: 'products' },
  { path: '/products/new', perm: ['products.manage'], load: () => import('./views/products.js').then((m) => m.form), nav: 'products', panel: '/products', title: 'Add product' },
  { path: '/products/:id/edit', perm: ['products.manage'], load: () => import('./views/products.js').then((m) => m.form), nav: 'products', panel: '/products', title: 'Edit product' },
  { path: '/products/:id/restock', perm: ['inventory.restock'], load: () => import('./views/products.js').then((m) => m.restock), nav: 'products', panel: '/products', title: 'Restock' },
  { path: '/inventory', perm: ['inventory.view'], load: () => import('./views/inventory.js').then((m) => m.default), nav: 'inventory' },
  { path: '/sales', perm: ['sales.view_own', 'sales.view_all'], load: () => import('./views/sales.js').then((m) => m.list), nav: 'sales' },
  { path: '/sales/:id', perm: ['sales.view_own', 'sales.view_all'], load: () => import('./views/sales.js').then((m) => m.detail), nav: 'sales' },
  { path: '/gcash', perm: ['gcash.view'], load: () => import('./views/gcash.js').then((m) => m.list), nav: 'gcash' },
  { path: '/gcash/cash-in', perm: ['gcash.transact'], load: () => import('./views/gcash.js').then((m) => m.cashIn), nav: 'gcash', panel: '/gcash', title: 'GCash cash in' },
  { path: '/gcash/cash-out', perm: ['gcash.transact'], load: () => import('./views/gcash.js').then((m) => m.cashOut), nav: 'gcash', panel: '/gcash', title: 'GCash cash out' },
  { path: '/gcash/:id', perm: ['gcash.view'], load: () => import('./views/gcash.js').then((m) => m.detail), nav: 'gcash' },
  { path: '/staff', perm: ['staff.manage'], load: () => import('./views/staff.js').then((m) => m.list), nav: 'staff' },
  { path: '/staff/new', perm: ['staff.manage'], load: () => import('./views/staff.js').then((m) => m.form), nav: 'staff', panel: '/staff', title: 'Add staff' },
  { path: '/staff/:id', perm: ['staff.manage'], load: () => import('./views/staff.js').then((m) => m.form), nav: 'staff', panel: '/staff', title: 'Edit staff' },
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
let screenToken = 0;
let screen = null;      // the screen showing, possibly under the side panel: { path, node, ready }
let panel = null;       // the open side panel

function render() {
  closeAllModals();                                          // dialogs belong to the page we are leaving
  const { path, query } = parseHash();
  const found = match(ROUTES, path);

  if (!found) { showPage(shellOrBare('', notFound())); return; }
  const { route, params } = found;

  if (route.auth !== false && !session.user) { go('/login'); return; }
  if (route.auth === false && session.user) { go('/'); return; }
  if (session.user && session.user.must_change_password && path !== '/new-password') { go('/new-password'); return; }
  if (!allowed(route)) { showPage(shellOrBare(route.nav, forbidden())); return; }

  const context = { params, query, user: session.user, path };
  if (route.panel) { showPanel(route, context); return; }
  if (panel) {
    const returning = screen && screen.path === currentPath();
    dropPanel();
    if (returning) return;                                   // it is still there, with its search, filters and scroll
  }
  showScreen(route, context);
}

const allowed = (route) => !route.perm || canAny(...route.perm);

function dropPanel() { if (panel) { const p = panel; panel = null; p.remove(); } }

// A message in place of a screen (not found, no access).
function showPage(node) {
  dropPanel();
  screenToken += 1; screen = null;
  app.replaceChildren(node);
}

function showScreen(route, context, at = currentPath()) {
  const token = ++screenToken;
  const bareScreen = route.auth === false || route.bare;
  const next = { path: at, node: null, ready: null };
  screen = bareScreen ? null : next;

  if (bareScreen) app.replaceChildren(spinnerBlock());
  else {
    // keep the sidebar while the screen loads
    const main = document.getElementById('main');
    if (main && app.querySelector('.shell')) {
      app.querySelector('.nav').replaceWith(shell(route.nav, h('div')).querySelector('.nav'));
      main.replaceChildren(spinnerBlock());
    } else app.replaceChildren(shell(route.nav, spinnerBlock()));
  }

  next.ready = (async () => {
    let node;
    try {
      const view = await route.load();
      node = await view(context);
    } catch (err) {
      console.error(err);
      node = errorBox(err);
    }
    if (token !== screenToken) return;                       // user navigated away meanwhile
    next.node = node;
    if (bareScreen) app.replaceChildren(node);
    else { app.replaceChildren(shell(route.nav, node)); window.scrollTo(0, 0); }
    document.title = `${titleFor(route.nav)} · CashNStore`;
  })();
}

// ---- the side panel ---------------------------------------------------------------------------------------
function showPanel(route, context) {
  const path = currentPath();
  if (panel && panel.path === path) return;
  dropPanel();

  // Opened directly (typed, bookmarked or refreshed): put the section's list behind it.
  if (!screen) {
    let base = route.panel;
    if (!allowed(match(ROUTES, base).route)) base = '/';     // may use this form but not see its list
    // If nothing is known to be underneath, add the list to history so that Back closes the panel.
    if (entryState().under === undefined) insertUnder(base);
    const behind = match(ROUTES, base);
    showScreen(behind.route, { params: behind.params, query: {}, user: session.user, path: base }, base);
  }

  const p = createSidePanel({ title: route.title, onClose: () => closePanel(p) });
  p.path = path;
  p.refreshBehind = refreshScreen;
  p.leaveTo = (to) => { if (p.isOpen()) { p.leaving = true; replaceWith(to); } };   // so Back skips the form
  panel = p;
  loadPanel(p, route, context);
}

async function loadPanel(p, route, context) {
  try {
    const view = await route.load();
    const spec = await view(context, p);
    if (panel === p) p.show(spec);                           // otherwise it was closed while loading
  } catch (err) {
    console.error(err);
    if (panel === p) p.fail(errorBox(err, () => { dropPanel(); render(); }));
  }
}

function closePanel(p) {
  if (panel !== p || p.leaving) return;
  p.leaving = true;
  if (entryState().under === screen.path) history.back();    // leaves nothing for Back to reopen
  else { rewrite(screen.path); render(); }
}

// Reloads the data of the screen under the panel. Screens that can do this set `node.refresh`.
async function refreshScreen() {
  const target = screen;
  if (!target) return;
  await target.ready;
  if (screen !== target || !target.node || !target.node.refresh) return;
  try { await target.node.refresh(); }
  catch (err) { toast(err.message, 'err'); return; }
  // if the refresh redrew whatever had focus, put focus on its replacement
  if (lastFocus && !lastFocus.isConnected && document.activeElement === document.body) {
    const again = stillThere(lastFocus);
    if (again) again.focus({ preventScroll: true });
  }
}
let lastFocus = null;      // what last had focus on the page itself, outside the panel and dialogs
document.addEventListener('focusin', (e) => { if (app.contains(e.target)) lastFocus = e.target; });

const isPanelPath = (path) => { const found = match(ROUTES, path.split('?')[0]); return !!(found && found.route.panel); };

async function onNavigate(move) {
  const p = panel; const to = currentPath();
  // Leaving an open panel by Back, a link or the address bar (but not by being signed out).
  if (p && !p.leaving && session.user && to !== p.path) {
    if (p.isDirty()) {
      if (move.delta) await travel(-move.delta); else rewrite(p.path);    // stay on the form while we ask
      closeAllModals();
      if (!(await p.confirmDiscard()) || panel !== p || p.leaving) return;
      p.leaving = true;
      if (move.fresh) leaveFor(to); else if (move.delta) history.go(move.delta); else replaceWith(to);
      return;
    }
    if (move.fresh && move.delta) { p.leaving = true; await travel(-move.delta); leaveFor(to); return; }
  }
  // remember what a newly opened panel sits on, so that closing it can simply go back
  if (move.fresh && isPanelPath(to) && !isPanelPath(move.from)) setEntryState({ under: move.from });
  render();
}

// Called on the panel's history entry: goes to `to` without leaving the form behind for Back.
async function leaveFor(to) {
  const { under } = entryState();
  if (under === undefined) { replaceWith(to); return; }
  await travel(-1);
  if (under === to) render(); else go(to);
}

const titleFor = (id) => (NAV.find((n) => n.id === id) || {}).label || 'CashNStore';
const shellOrBare = (nav, node) => (session.user ? shell(nav, node) : node);

const notFound = () => h('div', { class: 'empty' }, h('h3', null, 'Page not found'), h('p', null, 'That page does not exist.'), h('a', { class: 'btn primary', href: href('/') }, 'Back to dashboard'));
const forbidden = () => h('div', { class: 'empty' }, icon('lock', 40), h('h3', null, 'You do not have access to this page'), h('p', null, 'Ask the owner if you need it.'), h('a', { class: 'btn primary', href: href('/') }, 'Back to dashboard'));
const errorBox = (err, retry = () => render()) => h('div', { class: 'empty' }, icon('alert', 40), h('h3', null, 'Could not load this page'),
  h('p', null, err && err.message ? err.message : 'Something went wrong.'), h('button', { type: 'button', class: 'btn primary', onclick: retry }, 'Try again'));

// ---- start ----------------------------------------------------------------------------------------------
setUnauthorizedHandler(() => {
  if (session.user) { session.user = null; toast('You were signed out. Please sign in again.', 'err'); go('/login'); }
});

watchHistory(onNavigate);
window.addEventListener('beforeunload', (e) => {              // closing or refreshing the tab
  if (panel && panel.isOpen() && panel.isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

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
