import { api } from '../api.js';
import { h, peso, num, toast, openModal, field, input, withIcon, peso$, busy, setFieldError, debounce, confirmModal } from '../util.js';
import { icon } from '../icons.js';
import { session } from '../state.js';
import { pageHead, card, chips, emptyState, segmented } from '../components.js';
import { receiptNode, printReceipt } from '../receipt.js';
import { href } from '../router.js';

export default async function pos() {
  const data = await api.get('/api/products/pos');
  let products = data.products;
  const discountPct = Number(data.discount_percent);
  const cart = new Map();                       // product id -> qty
  let category = 'all'; let query = ''; let discountType = null;
  const byId = () => new Map(products.map((p) => [p.id, p]));

  // ---- cart maths (preview only; the server works out the real totals) ---------------------------------
  const lines = () => { const m = byId(); return [...cart].map(([id, qty]) => ({ p: m.get(id), qty })).filter((l) => l.p); };
  const subtotal = () => lines().reduce((a, l) => a + l.qty * Number(l.p.price), 0);
  const discount = () => (discountType ? Math.round(subtotal() * discountPct) / 100 : 0);
  const total = () => Math.round((subtotal() - discount()) * 100) / 100;
  const itemCount = () => [...cart.values()].reduce((a, b) => a + b, 0);

  function add(p, n = 1) {
    const have = cart.get(p.id) || 0;
    if (p.stock_qty === 0) return toast(`${p.name} is out of stock`, 'err');
    if (have + n > p.stock_qty) return toast(`Only ${p.stock_qty} ${p.name} in stock`, 'err');
    if (have + n <= 0) cart.delete(p.id); else cart.set(p.id, have + n);
    paintOrder();
  }

  // ---- product side ---------------------------------------------------------------------------------------
  const grid = h('div', { class: 'prod-grid' });
  const search = input({ type: 'search', placeholder: 'Search products or scan a barcode', autocomplete: 'off', 'aria-label': 'Search products' });
  function visible() {
    const q = query.trim().toLowerCase();
    return products.filter((p) => (category === 'all' || p.category_id === category) &&
      (!q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || (p.barcode || '') === q));
  }
  function paintGrid() {
    const list = visible();
    grid.replaceChildren(...(list.length ? list.map((p) => {
      const inCart = cart.get(p.id) || 0;
      return h('button', { class: 'prod-card', type: 'button', disabled: p.stock_qty === 0 ? true : null, onclick: () => add(p), title: p.description },
        h('div', { class: 'pic' }, p.image_url ? h('img', { src: p.image_url, alt: '', loading: 'lazy' }) : icon('box', 34)),
        h('b', null, p.name), h('div', { class: 'small muted' }, p.description || ' '),
        h('div', { class: 'row between' }, h('span', { class: 'price' }, peso(p.price, 2)),
          h('span', { class: `stock ${p.stock_status !== 'ok' ? 'bold' : ''}`, style: p.stock_status === 'out' ? { color: 'var(--bad)' } : p.stock_status === 'low' ? { color: 'var(--warn)' } : null }, p.stock_qty === 0 ? 'Out' : `${p.stock_qty} left`)),
        inCart ? h('span', { class: 'badge teal', style: { position: 'absolute', top: '8px', right: '8px' } }, `×${inCart}`) : null);
    }) : [h('div', { style: { gridColumn: '1 / -1' } }, emptyState({ art: 'search', title: 'No products found', text: 'Try a different name or category.' }))]));
  }
  search.addEventListener('input', debounce(() => { query = search.value; paintGrid(); }, 120));
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const code = search.value.trim(); const hit = products.find((p) => p.barcode && p.barcode === code);
    if (hit) { add(hit); search.value = ''; query = ''; paintGrid(); } else if (visible().length === 1) { add(visible()[0]); }
  });
  const catChips = h('div');
  const paintChips = () => catChips.replaceChildren(chips([{ value: 'all', label: 'All' }, ...data.categories.map((c) => ({ value: c.id, label: c.name }))], category, (v) => { category = v; paintGrid(); }));

  // ---- order side -------------------------------------------------------------------------------------------
  const orderBox = h('div');
  function paintOrder() {
    const ls = lines();
    const disc = h('div', { class: 'row s8 wrap' }, h('span', { class: 'small muted' }, 'Discount'),
      segmented([{ value: '', label: 'None' }, { value: 'senior', label: 'Senior' }, { value: 'pwd', label: 'PWD' }], discountType || '', (v) => { discountType = v || null; paintOrder(); }));
    orderBox.replaceChildren(card(h('div', null,
      ls.length ? h('div', null, ls.map(({ p, qty }) => h('div', { class: 'order-line' },
        h('div', null, h('div', { class: 'bold' }, p.name), h('div', { class: 'small muted' }, `${peso(p.price, 2)} each`)),
        h('div', { class: 'right bold num' }, peso(qty * p.price, 2)),
        h('div', { class: 'qty' }, h('button', { type: 'button', 'aria-label': `One less ${p.name}`, onclick: () => add(p, -1) }, '−'), h('span', null, qty), h('button', { type: 'button', 'aria-label': `One more ${p.name}`, onclick: () => add(p, 1) }, '+')),
        h('button', { class: 'btn ghost sm', style: { justifySelf: 'end' }, onclick: () => { cart.delete(p.id); paintOrder(); }, 'aria-label': `Remove ${p.name}` }, icon('trash', 16)))))
        : h('div', { class: 'empty', style: { padding: '28px 8px' } }, icon('cart', 36), h('h3', null, 'No items yet'), h('p', null, 'Tap a product to add it to the order.')),
      ls.length ? h('div', { style: { marginTop: '14px' } }, disc,
        h('div', { class: 'totals', style: { marginTop: '10px' } },
          h('div', null, h('span', { class: 'muted' }, `Subtotal (${itemCount()} items)`), h('span', { class: 'num' }, peso(subtotal(), 2))),
          discountType ? h('div', null, h('span', { class: 'muted' }, `${discountType === 'senior' ? 'Senior' : 'PWD'} discount ${discountPct}%`), h('span', { class: 'num' }, `-${peso(discount(), 2)}`)) : null,
          h('div', { class: 'grand' }, h('span', null, 'Total'), h('span', { class: 'num' }, peso(total(), 2)))),
        h('div', { class: 'row', style: { marginTop: '14px' } },
          h('button', { class: 'btn', onclick: async () => { if (await confirmModal({ title: 'Clear this order?', message: 'All items will be removed.', confirmText: 'Clear order', danger: true })) { cart.clear(); discountType = null; paintOrder(); } } }, 'Clear'),
          h('button', { class: 'btn primary lg grow', onclick: () => reviewStep() }, 'Review order'))) : null),
    { cls: 'order', title: 'Current order', subtitle: session.user.station || 'Register 1' }));
    paintGrid();
  }

  // ---- review -> payment -> success -> receipt ----------------------------------------------------------------
  let modal = null;
  const show = (node, wide = false) => { if (modal) modal.close(); modal = openModal(node, { wide }); return modal; };

  function reviewStep() {
    const ls = lines();
    show(h('div', null, h('h2', null, 'Review order'), h('p', { class: 'muted' }, 'Check the items with the customer.'),
      h('div', { style: { margin: '14px 0' } }, ls.map(({ p, qty }) => h('div', { class: 'row between', style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } },
        h('span', null, `${qty} × ${p.name}`), h('span', { class: 'num bold' }, peso(qty * p.price, 2))))),
      h('div', { class: 'totals' },
        h('div', null, h('span', { class: 'muted' }, 'Subtotal'), h('span', null, peso(subtotal(), 2))),
        discountType ? h('div', null, h('span', { class: 'muted' }, 'Discount'), h('span', null, `-${peso(discount(), 2)}`)) : null,
        h('div', { class: 'grand' }, h('span', null, 'Total'), h('span', null, peso(total(), 2)))),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: () => modal.close() }, 'Back to order'), h('button', { class: 'btn primary', onclick: paymentStep }, 'Continue to payment'))));
  }

  function paymentStep() {
    let method = 'cash'; let customer = null;
    const grand = total();
    const cash = peso$({ placeholder: '0' }); const cashInput = cash.querySelector('input');
    const change = h('div');
    const cashSection = h('div', { class: 'stack s12' });
    const utangSection = h('div', { class: 'stack s12' });
    const err = h('div', { class: 'alert err hidden', role: 'alert' });
    const pay = h('button', { class: 'btn primary lg grow' }, 'Charge');

    const received = () => Number(cashInput.value) || 0;
    function paintChange() {
      const short = received() < grand;
      change.replaceChildren(h('div', { class: `change-box ${received() && short ? 'short' : ''}` }, h('span', null, short && received() ? 'Still needed' : 'Change'), h('span', { class: 'num', style: { fontSize: '22px' } }, short ? peso(grand - received(), 2) : peso(received() - grand, 2))));
      pay.disabled = method === 'cash' ? short : method === 'utang' ? !customer : false;
    }
    cashInput.addEventListener('input', paintChange);
    const quick = h('div', { class: 'chips' }, [['Exact', grand], ['₱200', 200], ['₱500', 500], ['₱1,000', 1000]].map(([l, v]) => h('button', { type: 'button', class: 'chip', onclick: () => { cashInput.value = v; paintChange(); } }, l)));
    cashSection.append(field('Cash received', cash), quick, change);

    // Utang: pick an existing customer or type a new name
    const cName = input({ placeholder: 'Customer name', autocomplete: 'off' }); const results = h('div', { class: 'stack s8' });
    cName.addEventListener('input', debounce(async () => { customer = cName.value.trim() ? { name: cName.value.trim() } : null; paintChange(); try { const r = await api.get('/api/pos/customers', { q: cName.value }); results.replaceChildren(...r.customers.slice(0, 4).map((c) => h('button', { type: 'button', class: 'btn block sm', style: { justifyContent: 'space-between' }, onclick: () => { customer = { id: c.id, name: c.name }; cName.value = c.name; results.replaceChildren(h('div', { class: 'badge ok' }, `${c.name} · owes ${peso(c.balance, 2)}`)); paintChange(); } }, h('span', null, c.name), h('span', { class: 'muted' }, `owes ${peso(c.balance, 2)}`)))); } catch (_) { /* ignore */ } }, 200));
    utangSection.append(field('Who is taking this on credit?', withIcon(icon('user', 18), cName), { hint: 'Pick a name from the list, or type a new one to add them.' }), results,
      h('div', { class: 'alert info' }, icon('info', 18), 'The amount is added to this customer’s utang balance.'));

    const gcashSection = h('div', { class: 'alert info' }, icon('qr', 18), 'Ask the customer to pay the GCash QR. Tap Charge once the payment shows in your wallet.');
    const sectionBox = h('div');
    const paintSection = () => { sectionBox.replaceChildren(method === 'cash' ? cashSection : method === 'gcash' ? gcashSection : utangSection); paintChange(); };
    const methodBtns = h('div', { class: 'pay-methods' }, [['cash', 'Cash', 'banknote'], ['gcash', 'GCash', 'qr'], ['utang', 'Utang', 'book']].map(([k, label, ic]) =>
      h('button', { type: 'button', class: `pay-opt${k === method ? ' active' : ''}`, onclick: (e) => { method = k; [...methodBtns.children].forEach((b) => b.classList.remove('active')); e.currentTarget.classList.add('active'); paintSection(); } }, icon(ic, 24), label)));

    pay.addEventListener('click', () => busy(pay, async () => {
      err.classList.add('hidden');
      try {
        const body = { items: lines().map((l) => ({ product_id: l.p.id, qty: l.qty })), payment_method: method, discount_type: discountType };
        if (method === 'cash') body.cash_received = received();
        if (method === 'utang') { if (customer.id) body.customer_id = customer.id; else body.customer_name = customer.name; }
        const receipt = await api.post('/api/pos/checkout', body);
        cart.clear(); discountType = null; paintOrder(); refreshProducts();
        successStep(receipt);
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); if (ex.status === 400) refreshProducts(); }
    }));
    show(h('div', null, h('h2', null, 'Payment'), h('div', { class: 'row between', style: { margin: '10px 0 16px' } }, h('span', { class: 'muted' }, `${itemCount()} items`), h('b', { style: { fontSize: '26px' } }, peso(grand, 2))),
      methodBtns, h('div', { style: { margin: '16px 0 4px' } }, sectionBox), err,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: reviewStep }, 'Back'), pay)));
    paintSection();
  }

  function successStep(r) {
    show(h('div', { class: 'success' },
      h('div', { class: 'tick' }, icon('check', 36)), h('h2', null, 'Payment received'),
      h('p', { class: 'muted' }, `${r.sale.sale_no} · ${peso(r.sale.total, 2)} by ${r.sale.payment_method === 'gcash' ? 'GCash' : r.sale.payment_method === 'utang' ? 'utang' : 'cash'}`),
      r.sale.payment_method === 'cash' ? h('div', { class: 'change-box', style: { margin: '18px 0 4px' } }, h('span', null, 'Change to give'), h('span', { style: { fontSize: '26px' } }, peso(r.sale.change_given, 2))) : null,
      h('div', { class: 'modal-actions', style: { justifyContent: 'center' } }, h('button', { class: 'btn', onclick: () => receiptStep(r) }, icon('receipt', 16), 'View receipt'), h('button', { class: 'btn primary', onclick: () => { modal.close(); search.focus(); } }, 'New sale'))));
  }

  function receiptStep(r) {
    let size = '80'; const holder = h('div', { style: { maxHeight: '52vh', overflow: 'auto', padding: '4px' } });
    const paint = () => holder.replaceChildren(receiptNode(r, size));
    paint();
    show(h('div', null, h('div', { class: 'row between wrap' }, h('h2', null, 'Receipt'), segmented([{ value: '80', label: '80 mm' }, { value: '58', label: '58 mm' }, { value: 'a4', label: 'A4' }], size, (v) => { size = v; paint(); })),
      h('div', { style: { margin: '14px 0' } }, holder),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => sendStub() }, icon('send', 16), 'Send'),
        h('button', { class: 'btn', onclick: () => { printReceipt(holder.firstChild); } }, icon('download', 16), 'Download PDF'),
        h('button', { class: 'btn primary', onclick: () => printReceipt(holder.firstChild) }, icon('print', 16), 'Print'),
        h('button', { class: 'btn', onclick: () => { modal.close(); search.focus(); } }, 'New sale'))), true);
  }
  function sendStub() {
    const m = openModal(h('div', null, h('h2', null, 'Send receipt'), h('div', { class: 'alert warn', style: { margin: '14px 0' } }, icon('info', 18), 'Sending by SMS or email is not set up yet. Use Print, or choose “Save as PDF” in the print window.'),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: () => m.close() }, 'OK'))));
  }

  async function refreshProducts() { try { products = (await api.get('/api/products/pos')).products; paintGrid(); } catch (_) { /* keep old list */ } }

  paintChips(); paintOrder();
  const page = h('div', { class: 'stack' },
    pageHead({ title: 'Point of sale', subtitle: 'Tap products to build the order, then take payment.' }),
    h('div', { class: 'pos' },
      h('div', { class: 'stack s12' }, h('div', { class: 'row wrap' }, h('div', { class: 'grow', style: { minWidth: '240px' } }, withIcon(icon('search', 18), search)), h('span', { class: 'small muted' }, icon('barcode', 16), ' Scanner ready')), catChips, grid),
      orderBox));
  page.refresh = refreshProducts;
  setTimeout(() => search.focus(), 0);
  return page;
}
