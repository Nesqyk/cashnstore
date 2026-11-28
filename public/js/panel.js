// The side panel: add and edit screens that slide in from the right, over the screen you were on.
// This module is only the panel itself. main.js decides when it opens and closes (it follows the URL).
import { h, clear, spinnerBlock, confirmModal, closeAllModals, pushLayer, stillThere } from './util.js';
import { icon } from './icons.js';

// `onClose` takes the panel off the screen; it is only called once nothing unsaved would be lost.
export function createSidePanel({ title, onClose }) {
  const prevFocus = document.activeElement;
  let snapshot = null; let clean = null; let removed = false;

  const heading = h('h2', { id: 'side-panel-title' }, title);
  const sub = h('p', { class: 'sp-sub' });
  const content = h('div', { class: 'sp-content' }, spinnerBlock());
  const box = h('div', { class: 'side-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'side-panel-title', tabindex: '-1' },
    h('div', { class: 'sp-head' }, h('div', { class: 'grow' }, heading, sub),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', title: 'Close', onclick: () => panel.requestClose() }, icon('x', 18))),
    content);
  const back = h('div', { class: 'panel-back' }, box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) { e.preventDefault(); panel.requestClose(); } });
  const cancelButton = (label) => h('button', { type: 'button', class: 'btn', onclick: () => panel.requestClose() }, label);

  const panel = {
    leaving: false,                                      // set once it is on its way out
    isOpen: () => !removed && !panel.leaving,
    isDirty: () => !!snapshot && JSON.stringify(snapshot()) !== clean,
    markClean: () => { if (snapshot) clean = JSON.stringify(snapshot()); },
    confirmDiscard: () => confirmModal({ title: 'Discard changes?', message: 'What you changed here has not been saved.', confirmText: 'Discard', cancelText: 'Keep editing', danger: true }),

    // The user asked to close: clicking outside, Esc, the close button or Cancel.
    async requestClose() {
      if (!panel.isOpen()) return;
      if (panel.isDirty() && !(await panel.confirmDiscard())) return;
      if (panel.isOpen()) onClose();
    },
    // The work is saved: close without asking. Does nothing if the user already left.
    finish() { if (panel.isOpen()) { closeAllModals(); onClose(); } },

    // view = { title, subtitle, body, summary, error, actions, onSubmit, snapshot }
    // `body` scrolls; `summary`, `error` and the buttons stay at the bottom. `snapshot()` returns everything the user can change.
    show(view) {
      heading.textContent = view.title; sub.textContent = view.subtitle || '';
      const form = h('form', { class: 'sp-form', novalidate: true },
        h('div', { class: 'sp-body' }, view.body),
        h('div', { class: 'sp-foot' }, view.summary || null, view.error || null, h('div', { class: 'sp-buttons' }, cancelButton('Cancel'), view.actions)));
      form.addEventListener('submit', (e) => { e.preventDefault(); view.onSubmit(); });
      clear(content).append(form);
      snapshot = view.snapshot; panel.markClean();
      // take focus only if it is still on the panel or nowhere, not in a dialog on top of it
      if (box.contains(document.activeElement) || document.activeElement === document.body) {
        const first = form.querySelector('.sp-body :is(input, select, textarea):not([disabled])');
        if (first) first.focus();
      }
    },
    // Shown instead of the form when it cannot be loaded.
    fail(node) {
      clear(content).append(h('div', { class: 'sp-form' }, h('div', { class: 'sp-body' }, node),
        h('div', { class: 'sp-foot' }, h('div', { class: 'sp-buttons' }, cancelButton('Close')))));
    },

    scrollToTop() { const b = content.querySelector('.sp-body'); if (b) b.scrollTop = 0; },
    // After a failed save, bring the first field with a message into view.
    revealError() {
      const msg = content.querySelector('.sp-body .field .err:not(.hidden)');
      if (!msg) return;
      const fieldBox = msg.closest('.field');
      const inp = fieldBox.querySelector('input:not([disabled]), select, textarea');
      if (inp) inp.focus({ preventScroll: true });
      fieldBox.scrollIntoView({ block: 'nearest' });
    },

    remove() {
      if (removed) return;
      removed = true; back.remove(); removeLayer();
      document.documentElement.classList.remove('panel-open'); document.body.style.paddingRight = '';
      const target = prevFocus && prevFocus !== document.body ? stillThere(prevFocus) : document.getElementById('main');
      if (target) target.focus({ preventScroll: true });
    },
  };

  // stop the page behind from scrolling, without it shifting sideways when the scrollbar goes
  const scrollbar = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.classList.add('panel-open'); document.body.style.paddingRight = `${scrollbar}px`;
  document.getElementById('panel-root').append(back);
  const removeLayer = pushLayer({ el: back, dismiss: () => panel.requestClose(), coversApp: true });
  box.focus();
  return panel;
}
