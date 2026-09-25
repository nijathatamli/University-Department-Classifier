import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { requireUser } from './auth.js';
import {
  escapeHtml, formatDateTime, renderEmpty, renderError, renderPagination, renderSkeletons,
} from './ui.js';

await mountShell();
if (!(await requireUser())) throw new Error('redirecting');

const list = document.getElementById('list');
const pagination = document.getElementById('pagination');
const filters = document.getElementById('filters');
const state = { page: 1, pageSize: 10, status: '' };

const STATUS_LABEL = { NEW: 'Yeni', IN_REVIEW: 'Baxılır', RESOLVED: 'Həll edilib' };
const STATUS_CLASS = { NEW: 'badge-warn', IN_REVIEW: 'badge', RESOLVED: 'badge-ok' };

const card = (r) => {
  const confidence = r.confidence == null ? null : Math.round(r.confidence * 1000) / 10;
  return `
    <article class="card reveal">
      <div class="card-in">
        <div class="card-head">
          <span class="card-idx">#${r.ticketNumber}</span>
          <span class="card-key">${escapeHtml(formatDateTime(r.createdAt))}</span>
          <span class="dot-blue"></span>
        </div>

        <div class="row-between">
          <h2 class="h-card">${escapeHtml(r.department?.name ?? 'Təyin edilməyib')}</h2>
          <span class="badge ${STATUS_CLASS[r.status] ?? 'badge-neutral'}">
            ${escapeHtml(STATUS_LABEL[r.status] ?? r.status)}
          </span>
        </div>

        ${confidence == null ? '' : `
          <div class="row-between mt-4">
            <span class="meta">Etibarlılıq</span><span class="meta">${confidence}%</span>
          </div>
          <div class="bar mt-4" style="height:4px"><span style="width:${confidence}%"></span></div>`}

        <p class="card-desc" style="margin-top:14px">${escapeHtml(r.message)}</p>

        ${r.resolvedAt ? `<p class="meta" style="margin-top:12px">
          Həll edilib: ${escapeHtml(formatDateTime(r.resolvedAt))}</p>` : ''}
      </div>
    </article>`;
};

async function load() {
  renderSkeletons(list, 3);
  try {
    const data = await api.requests.mine({
      page: state.page, pageSize: state.pageSize, ...(state.status ? { status: state.status } : {}),
    });

    if (!data.items.length) {
      pagination.innerHTML = '';
      renderEmpty(list,
        state.status ? 'Bu statusda müraciət yoxdur' : 'Hələ müraciətiniz yoxdur',
        state.status
          ? 'Filtri dəyişin və ya yeni müraciət göndərin.'
          : 'İlk müraciətinizi göndərin — sistem onu avtomatik olaraq məsul şöbəyə yönləndirəcək.',
        { href: '/classifier', label: 'Müraciət göndər' });
      return;
    }

    list.innerHTML = `<div class="grid grid-2">${data.items.map(card).join('')}</div>`;
    renderPagination(pagination, data.pagination, (page) => {
      state.page = page;
      load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  } catch (error) {
    pagination.innerHTML = '';
    renderError(list,
      error instanceof ApiError ? error.message : 'Müraciətlər yüklənmədi.', load);
  }
}

filters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-status]');
  if (!button) return;
  state.status = button.dataset.status;
  state.page = 1;
  filters.querySelectorAll('[data-status]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b === button));
  });
  load();
});

await load();
