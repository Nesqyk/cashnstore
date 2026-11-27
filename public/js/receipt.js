// The printed receipt, built from { sale, items, store } as the server sends it.
import { h, peso, fmtDateTime } from './util.js';

const DISCOUNT_LABEL = { senior: 'Senior citizen discount', pwd: 'PWD discount' };
const METHOD = { cash: 'Cash', gcash: 'GCash', utang: 'Utang (credit)' };

export function receiptNode({ sale, items, store }, size = '80') {
  const line = (l, r, bold) => h('div', { class: 'ln', style: bold ? { fontWeight: 700 } : null }, h('span', null, l), h('span', null, r));
  return h('div', { class: `receipt w${size === 'a4' ? 'a4' : size}` },
    h('h4', null, store.store_name),
    store.address ? h('div', { class: 'c' }, store.address) : null,
    store.phone ? h('div', { class: 'c' }, store.phone) : null,
    store.tin ? h('div', { class: 'c' }, `TIN ${store.tin}`) : null,
    h('hr'),
    line('Receipt', sale.sale_no), line('Date', fmtDateTime(sale.created_at)), line('Cashier', sale.cashier),
    sale.customer ? line('Customer', sale.customer) : null,
    sale.status === 'refunded' ? h('div', { class: 'c', style: { fontWeight: 700, marginTop: '4px' } }, '*** REFUNDED ***') : null,
    h('hr'),
    items.map((i) => h('div', null, h('div', null, i.name + (i.description ? ` (${i.description})` : '')), line(`  ${i.qty} x ${peso(i.unit_price, 2)}`, peso(i.line_total, 2)))),
    h('hr'),
    line('Subtotal', peso(sale.subtotal, 2)),
    sale.discount > 0 ? line(DISCOUNT_LABEL[sale.discount_type] || 'Discount', `-${peso(sale.discount, 2)}`) : null,
    line('TOTAL', peso(sale.total, 2), true),
    line('Paid by', METHOD[sale.payment_method] || sale.payment_method),
    sale.payment_method === 'cash' && sale.cash_received != null ? [line('Cash', peso(sale.cash_received, 2)), line('Change', peso(sale.change_given, 2))] : null,
    h('hr'),
    h('div', { class: 'c' }, store.receipt_message || 'Salamat po!'),
    h('div', { class: 'c', style: { marginTop: '4px', opacity: '.7' } }, 'This is not an official receipt unless stamped by the owner.'));
}

// Print only the receipt: copy it into #print-root, hide everything else while printing.
export function printReceipt(node) {
  const root = document.createElement('div');
  root.id = 'print-root'; root.append(node.cloneNode(true));
  document.body.append(root); document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1000);   // some browsers do not fire afterprint
}
