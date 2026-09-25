import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { requireUser } from './auth.js';
import {
  escapeHtml, formatDateTime, observeReveals, renderEmpty, renderError,
  renderLoading, renderPagination, setLoading, toast,
} from './ui.js';

/**
 * Department queue. The department is taken from the session on the server —
 * there is no department parameter a staff user could tamper with.
 */

await mountShell();
const user = await requireUser({ roles: ['DEPARTMENT', 'ADMIN'] });
if (!user) throw new Error('redirecting');

const root = document.getElementById('department-root');
const state = { page: 1, pageSize: 10, status: '' };
let department = null;

const STATUS_LABEL = { NEW: 'Yeni', IN_REVIEW: 'Baxılır', RESOLVED: 'Həll edilib' };
const STATUS_CLASS = { NEW: 'badge-warn', IN_REVIEW: 'badge', RESOLVED: 'badge-ok' };

async function boot() {
  renderLoading(root, 'Panel yüklənir');
  try {
    const me = await api.department.me();
    department = me.department;

    if (!department && me.role === 'ADMIN') {
      // An admin has no queue of their own; send them to the admin console.
      root.innerHTML = `
        <div class="state">
          <div class="label-mono">Şöbə təyin edilməyib</div>
          <p>Admin hesabının öz növbəsi yoxdur. Bütün müraciətləri admin panelində görə bilərsiniz.</p>
          <a class="btn btn-primary" href="/admin">Admin panelinə keç</a>
        </div>`;
      return;
    }

    root.innerHTML = `
      <section class="page-head reveal">
        <div class="label-mono">[ Şöbə paneli ]</div>
        <h1 class="h-page">${escapeHtml(department?.name ?? 'Şöbə')}</h1>
        <p class="body-p">Bu şöbəyə yönləndirilmiş müraciətlər. Statusu dəyişdiyiniz anda
          tələbə də görür.</p>
      </section>

      <div class="grid grid-4 reveal" id="stat-cards"></div>

      <section class="row mt-8" id="filters">
        <button class="btn btn-ghost btn-sm" data-status="" aria-pressed="true">Hamısı</button>
        <button class="btn btn-ghost btn-sm" data-status="NEW" aria-pressed="false">Yeni</button>
        <button class="btn btn-ghost btn-sm" data-status="IN_REVIEW" aria-pressed="false">Baxılır</button>
        <button class="btn btn-ghost btn-sm" data-status="RESOLVED" aria-pressed="false">Həll edilib</button>
      </section>

      <section id="queue" class="mt-8"></section>
      <nav id="pagination" class="pagination" aria-label="Pagination"></nav>`;

    document.getElementById('filters').addEventListener('click', (event) => {
      const button = event.target.closest('[data-status]');
      if (!button) return;
      state.status = button.dataset.status;
      state.page = 1;
      document.getElementById('filters')
        .querySelectorAll('[data-status]')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      loadQueue();
    });

    observeReveals(root);
    await Promise.all([loadStats(), loadQueue()]);
  } catch (error) {
    renderError(root, error instanceof ApiError ? error.message : 'Panel yüklənmədi.', boot);
  }
}

async function loadStats() {
  const box = document.getElementById('stat-cards');
  if (!box) return;
  try {
    const { byStatus } = await api.department.stats();
    const total = Object.values(byStatus ?? {}).reduce((a, b) => a + b, 0);
    const cards = [
      ['Ümumi', total],
      ['Yeni', byStatus?.NEW ?? 0],
      ['Baxılır', byStatus?.IN_REVIEW ?? 0],
      ['Həll edilib', byStatus?.RESOLVED ?? 0],
    ];
    box.innerHTML = cards.map(([label, value]) => `
      <article class="card"><div class="card-in">
        <div class="card-head"><span class="card-key">${escapeHtml(label)}</span>
          <span class="dot-blue"></span></div>
        <div class="h-page" style="font-size:2.2rem">${value}</div>
      </div></article>`).join('');
  } catch {
    box.innerHTML = '';
  }
}

async function loadQueue() {
  const queue = document.getElementById('queue');
  const pagination = document.getElementById('pagination');
  if (!queue) return;

  queue.innerHTML = '<div class="state"><div class="spinner"></div></div>';
  try {
    const data = await api.department.requests({
      page: state.page, pageSize: state.pageSize, ...(state.status ? { status: state.status } : {}),
    });

    if (!data.items.length) {
      pagination.innerHTML = '';
      renderEmpty(queue, 'Müraciət yoxdur',
        state.status ? 'Bu statusda müraciət tapılmadı.' : 'Bu şöbəyə hələ müraciət yönləndirilməyib.');
      return;
    }

    queue.innerHTML = data.items.map(ticket).join('');
    wireActions(queue);
    renderPagination(pagination, data.pagination, (page) => { state.page = page; loadQueue(); });
  } catch (error) {
    pagination.innerHTML = '';
    renderError(queue, error instanceof ApiError ? error.message : 'Növbə yüklənmədi.', loadQueue);
  }
}

function ticket(r) {
  const confidence = r.confidence == null ? null : Math.round(r.confidence * 1000) / 10;
  const low = confidence != null && confidence < 50;
  const studentName = [r.student?.firstName, r.student?.lastName].filter(Boolean).join(' ');

  return `
    <article class="panel" style="margin-bottom:14px">
      <div class="row-between">
        <div>
          <span class="card-idx" style="font-size:12px">#${r.ticketNumber}</span>
          <span class="meta" style="margin-left:10px">${escapeHtml(formatDateTime(r.createdAt))}</span>
        </div>
        <span class="badge ${STATUS_CLASS[r.status] ?? 'badge-neutral'}">
          ${escapeHtml(STATUS_LABEL[r.status] ?? r.status)}
        </span>
      </div>

      <p class="body-p mt-6" style="font-size:15px">${escapeHtml(r.message)}</p>

      <div class="row-between mt-6">
        <span class="meta">${escapeHtml(studentName)} · ${escapeHtml(r.student?.email ?? '')}</span>
        ${confidence == null ? '' : `
          <span class="badge ${low ? 'badge-warn' : 'badge-neutral'}">
            Etibarlılıq ${confidence}%${low ? ' · aşağı' : ''}
          </span>`}
      </div>

      <div class="row mt-6">
        <button class="btn btn-ghost btn-sm" data-set="IN_REVIEW" data-id="${escapeHtml(r.id)}"
                ${r.status === 'IN_REVIEW' ? 'disabled' : ''}>Baxılır olaraq işarələ</button>
        <button class="btn btn-primary btn-sm" data-set="RESOLVED" data-id="${escapeHtml(r.id)}"
                ${r.status === 'RESOLVED' ? 'disabled' : ''}>Həll edildi</button>
        ${r.status !== 'NEW'
          ? `<button class="btn btn-ghost btn-sm" data-set="NEW" data-id="${escapeHtml(r.id)}">Yenidən aç</button>`
          : ''}
      </div>
    </article>`;
}

function wireActions(scope) {
  scope.querySelectorAll('[data-set]').forEach((button) => {
    button.addEventListener('click', async () => {
      setLoading(button, true);
      try {
        await api.requests.setStatus(button.dataset.id, button.dataset.set);
        toast('Status yeniləndi', 'success');
        await Promise.all([loadStats(), loadQueue()]);
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'Status dəyişdirilmədi.', 'error');
        setLoading(button, false);
      }
    });
  });
}

await boot();
