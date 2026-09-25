/** Shared UI primitives: escaping, states, toasts, dialogs, reveals. */

export const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined && value !== false) {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};

/** Always use this before putting server data into innerHTML. */
export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// --- async states -----------------------------------------------------------

export function renderLoading(container, message = 'Loading') {
  container.innerHTML = `
    <div class="state" role="status" aria-live="polite">
      <div class="spinner"></div>
      <div class="label-mono">${escapeHtml(message)}</div>
    </div>`;
}

export function renderSkeletons(container, count = 6, className = 'skeleton-card') {
  container.innerHTML = Array.from({ length: count })
    .map(() => `<div class="skeleton ${className}" aria-hidden="true"></div>`)
    .join('');
}

export function renderError(container, message, onRetry) {
  container.innerHTML = `
    <div class="state" role="alert">
      <div class="label-mono">Something went wrong</div>
      <p>${escapeHtml(message)}</p>
      ${onRetry ? '<button class="btn btn-ghost" data-retry>Try again</button>' : ''}
    </div>`;
  if (onRetry) container.querySelector('[data-retry]')?.addEventListener('click', onRetry);
}

export function renderEmpty(container, title, message, action) {
  container.innerHTML = `
    <div class="state">
      <div class="label-mono">${escapeHtml(title)}</div>
      <p>${escapeHtml(message)}</p>
      ${action ? `<a class="btn btn-primary" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>` : ''}
    </div>`;
}

// --- toasts -----------------------------------------------------------------

function toastRegion() {
  let region = document.getElementById('toast-region');
  if (!region) {
    region = el('div', { id: 'toast-region', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.append(region);
  }
  return region;
}

export function toast(message, variant = 'info') {
  const node = el('div', { class: `toast toast--${variant}`, role: variant === 'error' ? 'alert' : 'status', text: message });
  toastRegion().append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .35s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 400);
  }, 4200);
}

// --- confirm dialog ---------------------------------------------------------

/** Accessible confirmation: focus-trapped, Escape closes, returns a promise. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const confirmBtn = el('button', {
      class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel,
    });
    const cancelBtn = el('button', { class: 'btn btn-ghost', text: 'Cancel' });

    const dialog = el('div', {
      class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title',
    }, [
      el('h2', { class: 'h-card', id: 'dlg-title', text: title }),
      el('p', { class: 'body-p', style: 'margin-top:10px;font-size:15px', text: message }),
      el('div', { class: 'row', style: 'margin-top:22px;justify-content:flex-end' }, [cancelBtn, confirmBtn]),
    ]);
    const scrim = el('div', { class: 'dialog-scrim' }, [dialog]);

    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      scrim.remove();
      previous?.focus?.();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Tab') {
        const focusables = [cancelBtn, confirmBtn];
        const i = focusables.indexOf(document.activeElement);
        e.preventDefault();
        focusables[(i + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length].focus();
      }
    };

    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(false); });
    document.addEventListener('keydown', onKey);
    document.body.append(scrim);
    confirmBtn.focus();
  });
}

// --- misc -------------------------------------------------------------------

export function setLoading(button, loading) {
  if (!button) return;
  button.dataset.loading = loading ? 'true' : 'false';
  button.disabled = !!loading;
}

export function observeReveals(root = document) {
  const targets = $$('.reveal:not(.in)', root);
  if (!targets.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.style.transitionDelay = `${entry.target.dataset.delay || 0}s`;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    }
  }, { threshold: 0.2 });
  targets.forEach((t) => io.observe(t));
}

export const formatDate = (value) =>
  new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export const formatDateTime = (value) =>
  new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export function renderPagination(container, pagination, onPage) {
  const { page, totalPages, total } = pagination;
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  container.innerHTML = '';
  const prev = el('button', { class: 'btn btn-ghost btn-sm', text: 'Previous', disabled: page <= 1 });
  const next = el('button', { class: 'btn btn-ghost btn-sm', text: 'Next', disabled: page >= totalPages });
  prev.addEventListener('click', () => onPage(page - 1));
  next.addEventListener('click', () => onPage(page + 1));
  container.append(prev, el('span', { class: 'page-info', text: `Page ${page} of ${totalPages} · ${total} total` }), next);
}
