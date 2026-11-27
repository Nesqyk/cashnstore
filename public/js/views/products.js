import { api } from '../api.js';
import { h, peso, num, fmtDay, toast, openModal, field, input, withIcon, peso$, busy, showFieldErrors, setFieldError, debounce, confirmModal } from '../util.js';
import { icon } from '../icons.js';
import { can } from '../state.js';
import { pageHead, card, chips, emptyState, pager, stockBadge, insightStrip } from '../components.js';
import { sparkline } from '../charts.js';
import { href, go } from '../router.js';

const select = (options, value, props = {}) => {
  const s = h('select', { class: 'input', ...props }, options.map((o) => h('option', { value: o.value }, o.label)));
  s.value = value ?? ''; return s;
};

// ---- list ------------------------------------------------------------------------------------------------
export async function list({ query }) {
  const state = { page: 1, q: '', status: 'active', category: '', sort: 'name' };
  const cats = (await api.get('/api/categories')).categories;
  const page = h('div', { class: 'stack' });
  const body = h('div');
  const strip = h('div');

  page.append(pageHead({ title: 'Products', subtitle: 'Everything you sell, with prices and stock.',
    actions: can('products.manage') ? h('a', { class: 'btn primary', href: href('/products/new') }, icon('plus', 16), 'Add product') : null }));
  page.append(strip, body);

  if (can('analytics.store')) {
    api.get('/api/products/analytics').then((a) => {
      strip.replaceChildren(insightStrip([
        { value: `${a.healthy} of ${a.total}`, label: 'products well stocked' },
        { value: a.low + a.out, label: 'low or out', color: a.low + a.out ? 'var(--warn)' : null },
        { value: peso(a.value_cost), label: 'stock value at cost' },
        { value: peso(a.value_retail), label: 'if all sold at price' },
        { value: a.slow_count, label: a.slow_count ? `slow movers: ${a.slow_movers.map((s) => s.name).slice(0, 2).join(', ')}` : 'slow movers' },
        h('div', { class: 'ins' }, sparkline(a.value_trend.map((v) => v.value)), h('span', null, 'stock value, 12 days')),
      ]));
    }).catch(() => {});
  }

  async function load() {
    body.replaceChildren(h('div', { class: 'card skeleton', style: { height: '320px' } }));
    let r;
    try { r = await api.get('/api/products', { page: state.page, size: 10, q: state.q, status: state.status, category: state.category, sort: state.sort }); }
    catch (ex) { body.replaceChildren(h('div', { class: 'alert err' }, ex.message)); return; }
    const c = r.counts;
    const filters = h('div', { class: 'toolbar' },
      h('div', { class: 'search' }, withIcon(icon('search', 18), Object.assign(input({ type: 'search', placeholder: 'Search by name or barcode', value: state.q, 'aria-label': 'Search products' }), {}))),
      select([{ value: '', label: 'All categories' }, ...cats.map((x) => ({ value: x.id, label: x.name }))], state.category, { 'aria-label': 'Category', style: 'width:auto', onchange: (e) => { state.category = e.target.value; state.page = 1; load(); } }),
      select([{ value: 'name', label: 'Sort: Name' }, { value: 'price', label: 'Sort: Price' }, { value: 'stock', label: 'Sort: Lowest stock' }, { value: 'newest', label: 'Sort: Newest' }], state.sort, { 'aria-label': 'Sort', style: 'width:auto', onchange: (e) => { state.sort = e.target.value; load(); } }));
    const searchInput = filters.querySelector('input');
    searchInput.addEventListener('input', debounce(() => { state.q = searchInput.value; state.page = 1; load().then(() => { const i = body.querySelector('input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 300));
    const statusChips = chips([{ value: 'active', label: `Active (${c.active})` }, { value: 'low', label: `Low stock (${c.low})` }, { value: 'out', label: `Out of stock (${c.out})` }, { value: 'archived', label: `Archived (${c.archived})` }], state.status, (v) => { state.status = v; state.page = 1; load(); });

    let table;
    if (!r.products.length) {
      const nothingAtAll = c.active + c.archived === 0;
      table = emptyState(nothingAtAll
        ? { art: 'products', title: 'No products yet', text: 'Add what you sell so you can ring it up at the register.', action: can('products.manage') ? h('a', { class: 'btn primary', href: href('/products/new') }, 'Add your first product') : null }
        : { art: 'search', title: 'No products match', text: 'Try another word, or clear the filters.', action: h('button', { class: 'btn', onclick: () => { Object.assign(state, { q: '', status: 'active', category: '', page: 1 }); load(); } }, 'Clear filters') });
    } else {
      table = h('div', null, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Product', 'Category', 'Price', 'Cost', 'Stock', 'Status', ''].map((t, i) => h('th', { class: i === 2 || i === 3 ? 'right' : '' }, t)))),
        h('tbody', null, r.products.map((p) => h('tr', { class: can('products.manage') ? 'click' : '', onclick: () => can('products.manage') && go(`/products/${p.id}/edit`) },
          h('td', null, h('div', { class: 'row' }, h('div', { class: 'avatar', style: { borderRadius: '10px' } }, p.image_url ? h('img', { src: p.image_url, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : icon('box', 20)),
            h('div', null, h('div', { class: 'bold' }, p.name), h('div', { class: 'small muted' }, p.description || ' ')))),
          h('td', null, p.category || h('span', { class: 'muted' }, 'None')),
          h('td', { class: 'right num bold' }, peso(p.price, 2)), h('td', { class: 'right num muted' }, peso(p.cost, 2)),
          h('td', { class: 'num' }, `${num(p.stock_qty)} ${p.unit}`, h('div', { class: 'tiny muted' }, `reorder at ${p.reorder_level}`)),
          h('td', null, p.is_active ? stockBadge(p.stock_status) : h('span', { class: 'badge' }, 'Archived')),
          h('td', { class: 'right' }, can('inventory.restock') && p.is_active ? h('a', { class: 'btn sm', href: href(`/products/${p.id}/restock`), onclick: (e) => e.stopPropagation() }, 'Restock') : null)))))),
      pager({ page: r.page, size: r.size, total: r.total, noun: 'products', onPage: (n) => { state.page = n; load(); } }));
    }
    body.replaceChildren(h('div', { class: 'stack s12' }, filters, statusChips, h('div', { class: 'card flush' }, table)));
  }
  await load();
  return page;
}

// ---- add / edit -------------------------------------------------------------------------------------------
export async function form({ params }) {
  const editing = !!params.id;
  const [cats, sups, existing] = await Promise.all([api.get('/api/categories'), api.get('/api/suppliers'),
    editing ? api.get(`/api/products/${params.id}`) : Promise.resolve(null)]);
  const p = existing ? existing.product : { name: '', description: '', barcode: '', category_id: '', supplier_id: '', price: '', cost: '', stock_qty: 0, reorder_level: 5, unit: 'pcs', image_url: '' };

  const f = {
    name: input({ value: p.name, placeholder: 'e.g. Lucky Me! Pancit Canton' }),
    description: input({ value: p.description, placeholder: 'e.g. Kalamansi 80g' }),
    barcode: input({ value: p.barcode || '', placeholder: 'Scan or type the barcode' }),
    category_id: select([{ value: '', label: 'No category' }, ...cats.categories.map((c) => ({ value: c.id, label: c.name }))], p.category_id),
    supplier_id: select([{ value: '', label: 'No supplier' }, ...sups.suppliers.map((c) => ({ value: c.id, label: c.name }))], p.supplier_id),
    price: peso$({ value: p.price, placeholder: '0.00' }), cost: peso$({ value: p.cost, placeholder: '0.00' }),
    stock_qty: input({ type: 'number', min: 0, value: p.stock_qty, inputmode: 'numeric' }),
    reorder_level: input({ type: 'number', min: 0, value: p.reorder_level, inputmode: 'numeric' }),
    unit: input({ value: p.unit, placeholder: 'pcs, bottles, kg…' }),
    image_url: input({ value: p.image_url || '', placeholder: 'https://… (optional)' }),
  };
  const priceIn = f.price.querySelector('input'); const costIn = f.cost.querySelector('input');
  const boxes = {
    name: field('Product name', f.name), description: field('Description', f.description, { hint: 'Size or flavour, shown under the name.' }),
    barcode: field('Barcode', withIcon(icon('barcode', 18), f.barcode)), category_id: field('Category', f.category_id), supplier_id: field('Usual supplier', f.supplier_id),
    price: field('Selling price', f.price), cost: field('Cost per unit', f.cost), stock_qty: field(editing ? 'Stock on hand' : 'Starting stock', f.stock_qty, editing ? { hint: 'Use “Adjust stock” to change this with a note.' } : {}),
    reorder_level: field('Reorder level', f.reorder_level, { hint: 'You will be warned when stock falls to this number.' }), unit: field('Unit', f.unit), image_url: field('Photo link', f.image_url),
  };
  if (editing) f.stock_qty.disabled = true;

  const priceChips = h('div', { class: 'chips' }, [5, 10, 15, 20, 25, 50, 100].map((v) => h('button', { type: 'button', class: 'chip', onclick: () => { priceIn.value = v; refresh(); } }, `₱${v}`)));
  const margin = h('div', { class: 'small muted' });
  const preview = h('div', { class: 'prod-card', style: { maxWidth: '200px', cursor: 'default' } });
  function refresh() {
    const pr = Number(priceIn.value) || 0; const co = Number(costIn.value) || 0;
    margin.textContent = pr && co ? `Profit per unit ${peso(pr - co, 2)} (${pr > 0 ? Math.round(((pr - co) / pr) * 100) : 0}% margin)` : '';
    preview.replaceChildren(h('div', { class: 'pic' }, f.image_url.value ? h('img', { src: f.image_url.value, alt: '' }) : icon('box', 34)),
      h('b', null, f.name.value || 'Product name'), h('div', { class: 'small muted' }, f.description.value || ' '),
      h('div', { class: 'row between' }, h('span', { class: 'price' }, peso(pr, 2)), h('span', { class: 'stock' }, `${f.stock_qty.value || 0} left`)));
  }
  [f.name, f.description, f.image_url, f.stock_qty, priceIn, costIn].forEach((el) => el.addEventListener('input', refresh));
  refresh();

  const err = h('div', { class: 'alert err hidden', role: 'alert' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save changes' : 'Add product');
  const formEl = h('form', { class: 'stack', novalidate: true },
    card(h('div', { class: 'form-grid' }, h('div', { class: 'full' }, boxes.name), h('div', { class: 'full' }, boxes.description), boxes.category_id, boxes.barcode), { title: 'Product details' }),
    card(h('div', { class: 'form-grid' }, h('div', null, boxes.price, h('div', { style: { marginTop: '8px' } }, priceChips)), boxes.cost, h('div', { class: 'full' }, margin)), { title: 'Pricing' }),
    card(h('div', { class: 'form-grid' }, boxes.stock_qty, boxes.unit, boxes.reorder_level, boxes.supplier_id), { title: 'Stock' }),
    card(h('div', { class: 'form-grid' }, h('div', { class: 'full' }, boxes.image_url, h('p', { class: 'hint small muted' }, 'Paste a link to a photo. Upload is not set up yet.'))), { title: 'Photo' }),
    err);
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault(); err.classList.add('hidden'); showFieldErrors(boxes);
    const body = { name: f.name.value, description: f.description.value, barcode: f.barcode.value, category_id: f.category_id.value, supplier_id: f.supplier_id.value,
      price: priceIn.value, cost: costIn.value, stock_qty: f.stock_qty.value, reorder_level: f.reorder_level.value, unit: f.unit.value, image_url: f.image_url.value };
    await busy(save, async () => {
      try {
        if (editing) await api.put(`/api/products/${params.id}`, body); else await api.post('/api/products', body);
        toast(editing ? 'Product saved' : 'Product added', 'ok'); go('/products');
      } catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(boxes, ex.fields); else { err.textContent = ex.message; err.classList.remove('hidden'); } }
    });
  });

  const archiveBtns = editing ? [
    h('button', { class: 'btn', type: 'button', onclick: () => adjustModal(p) }, 'Adjust stock'),
    h('button', { class: `btn ${p.is_active ? 'danger' : ''}`, type: 'button', onclick: async () => {
      if (await confirmModal({ title: p.is_active ? 'Archive this product?' : 'Bring it back?', message: p.is_active ? 'It will no longer show at the register. Past sales keep their history.' : 'It will show at the register again.', confirmText: p.is_active ? 'Archive' : 'Restore', danger: p.is_active })) {
        await api.post(`/api/products/${params.id}/archive`, { active: !p.is_active }); toast(p.is_active ? 'Product archived' : 'Product restored', 'ok'); go('/products');
      } } }, p.is_active ? 'Archive' : 'Restore')] : [];

  return h('div', { class: 'stack' },
    pageHead({ crumb: { to: '/products', label: 'Products' }, title: editing ? p.name : 'Add product', subtitle: editing ? 'Change the price, stock rules or details.' : 'Add something new to sell.', actions: archiveBtns }),
    h('div', { class: 'grid g-main' }, formEl,
      h('div', { class: 'stack' }, card(h('div', { class: 'stack s12' }, preview, h('p', { class: 'small muted' }, 'This is how it looks to the cashier on the register.')), { title: 'How it shows on the register' }),
        h('div', { class: 'row' }, h('a', { class: 'btn grow', href: href('/products') }, 'Cancel'), h('button', { class: 'btn primary grow', onclick: () => formEl.requestSubmit() }, editing ? 'Save changes' : 'Add product')))));
}

function adjustModal(p) {
  const qty = input({ type: 'number', min: 0, value: p.stock_qty }); const note = input({ placeholder: 'e.g. Counted the shelf' });
  const box = field('Actual count on the shelf', qty); const btn = h('button', { class: 'btn primary' }, 'Save count');
  const m = openModal(h('div', null, h('h2', null, 'Adjust stock'), h('p', { class: 'muted' }, `${p.name}: the system says ${p.stock_qty} ${p.unit}.`),
    h('div', { class: 'stack', style: { marginTop: '14px' } }, box, field('Reason (optional)', note)),
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), btn)));
  btn.addEventListener('click', () => busy(btn, async () => {
    try { await api.post(`/api/products/${p.id}/adjust`, { stock_qty: qty.value, note: note.value }); m.close(); toast('Stock updated', 'ok'); go(`/products/${p.id}/edit`); }
    catch (ex) { setFieldError(box, ex.fields?.stock_qty || ex.message); }
  }));
}

// ---- restock ---------------------------------------------------------------------------------------------
export async function restock({ params }) {
  const [{ product: p }, sups] = await Promise.all([api.get(`/api/products/${params.id}`), api.get('/api/suppliers')]);
  const supplier = select([{ value: '', label: 'Choose supplier' }, ...sups.suppliers.map((s) => ({ value: s.id, label: s.name }))], p.supplier_id);
  const invoice = input({ placeholder: 'Optional, from the receipt' });
  const qty = input({ type: 'number', min: 1, value: '', inputmode: 'numeric', placeholder: '0' });
  const cost = peso$({ value: p.cost, placeholder: '0.00' }); const costIn = cost.querySelector('input');
  const date = input({ type: 'date', value: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) });
  const boxes = { supplier_id: field('Supplier', supplier), invoice_no: field('Invoice number', invoice), quantity: field('Quantity received', qty), unit_cost: field('Cost per unit', cost), received_on: field('Date received', date) };
  const after = h('div', { class: 'stack s12' });
  function paint() {
    const q = parseInt(qty.value, 10) || 0; const c = Number(costIn.value) || 0;
    after.replaceChildren(
      h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Stock now'), h('b', null, `${num(p.stock_qty)} ${p.unit}`)),
      h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Adding'), h('b', null, `+${num(q)}`)),
      h('hr', { class: 'divider' }),
      h('div', { class: 'row between' }, h('span', { class: 'bold' }, 'After this restock'), h('b', { style: { fontSize: '22px', color: 'var(--teal)' } }, `${num(p.stock_qty + q)} ${p.unit}`)),
      h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Total cost'), h('b', null, peso(q * c, 2))),
      c && p.price ? h('div', { class: 'small muted' }, `New profit per unit ${peso(p.price - c, 2)}`) : null,
      p.stock_qty + q <= p.reorder_level && q ? h('div', { class: 'alert warn' }, icon('alert', 16), 'Still at or below the reorder level.') : null);
  }
  [qty, costIn].forEach((el) => el.addEventListener('input', paint)); paint();
  const qtyChips = h('div', { class: 'chips' }, [10, 20, 50, 100].map((n) => h('button', { type: 'button', class: 'chip', onclick: () => { qty.value = (parseInt(qty.value, 10) || 0) + n; paint(); } }, `+${n}`)));
  const err = h('div', { class: 'alert err hidden' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save restock');
  const formEl = h('form', { class: 'stack', novalidate: true },
    card(h('div', { class: 'form-grid' }, boxes.supplier_id, boxes.invoice_no, h('div', null, boxes.quantity, h('div', { style: { marginTop: '8px' } }, qtyChips)), boxes.unit_cost, boxes.received_on), { title: 'Delivery details' }), err,
    h('div', { class: 'row' }, h('a', { class: 'btn', href: href('/products') }, 'Cancel'), save));
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault(); err.classList.add('hidden'); showFieldErrors(boxes);
    await busy(save, async () => {
      try { const r = await api.post(`/api/products/${p.id}/restock`, { supplier_id: supplier.value, invoice_no: invoice.value, quantity: qty.value, unit_cost: costIn.value, received_on: date.value });
        toast(`Restocked. ${p.name} now has ${r.stock_after} ${p.unit}.`, 'ok'); go('/inventory'); }
      catch (ex) { if (ex.fields && Object.keys(ex.fields).length) showFieldErrors(boxes, ex.fields); else { err.textContent = ex.message; err.classList.remove('hidden'); } }
    });
  });
  return h('div', { class: 'stack' }, pageHead({ crumb: { to: '/products', label: 'Products' }, title: `Restock ${p.name}`, subtitle: p.description || 'Record a delivery from your supplier.' }),
    h('div', { class: 'grid g-main' }, formEl, card(after, { title: 'After this restock' })));
}
