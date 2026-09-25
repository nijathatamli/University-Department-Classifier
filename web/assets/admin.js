import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { requireUser } from './auth.js';
import {
  escapeHtml, formatDateTime, renderError, renderLoading, renderPagination, toast,
} from './ui.js';

/** Admin console. Every figure is a live database aggregate or a measured metric. */

await mountShell();
const user = await requireUser({ roles: ['ADMIN'] });
if (!user) throw new Error('redirecting');

const root = document.getElementById('admin-root');

const TABS = [
  ['overview', 'İcmal'],
  ['requests', 'Müraciətlər'],
  ['model', 'Model'],
  ['departments', 'Şöbələr'],
  ['users', 'İstifadəçilər'],
  ['contacts', 'Mesajlar'],
  ['audit', 'Audit'],
];

const STATUS_LABEL = { NEW: 'Yeni', IN_REVIEW: 'Baxılır', RESOLVED: 'Həll edilib' };
const STATUS_CLASS = { NEW: 'badge-warn', IN_REVIEW: 'badge', RESOLVED: 'badge-ok' };

let activeTab = location.hash.slice(1) || TABS[0][0];
if (!TABS.some(([id]) => id === activeTab)) activeTab = TABS[0][0];

const panel = (title, inner) =>
  `<section class="panel"><h2 class="h-section">${escapeHtml(title)}</h2>${inner}</section>`;

const table = (headers, rows) => `
  <div class="table-wrap mt-6">
    <table class="data">
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

function shell() {
  root.innerHTML = `
    <section class="page-head">
      <div class="label-mono">[ Admin ]</div>
      <h1 class="h-page">Panel.</h1>
      <p class="body-p">${escapeHtml(user.email)} · <span class="badge">${escapeHtml(user.role)}</span></p>
    </section>

    <nav class="chips" aria-label="Bölmələr">
      ${TABS.map(([id, label]) => `
        <button class="chip" data-tab="${id}" aria-pressed="${id === activeTab}">
          ${escapeHtml(label)}</button>`).join('')}
    </nav>

    <section id="tab-body" class="mt-8"></section>`;

  root.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.tab;
      location.hash = activeTab;
      shell();
    });
  });
  renderTab();
}

async function renderTab() {
  const body = document.getElementById('tab-body');
  renderLoading(body, 'Yüklənir');
  try {
    if (activeTab === 'overview') await renderOverview(body);
    else if (activeTab === 'requests') await renderRequests(body);
    else if (activeTab === 'model') await renderModel(body);
    else if (activeTab === 'departments') await renderDepartments(body);
    else if (activeTab === 'users') await renderUsers(body);
    else if (activeTab === 'contacts') await renderContacts(body);
    else if (activeTab === 'audit') await renderAudit(body);
  } catch (error) {
    renderError(body, error instanceof ApiError ? error.message : 'Bölmə yüklənmədi.',
      () => renderTab());
  }
}

// --- overview ---------------------------------------------------------------

async function renderOverview(body) {
  const stats = await api.admin.stats();
  const byStatus = Object.fromEntries(stats.byStatus.map((s) => [s.status, s.count]));
  const maxDept = Math.max(1, ...stats.byDepartment.map((d) => d.count));
  const maxVolume = Math.max(1, ...stats.volume.map((v) => v.count));

  body.innerHTML = `
    <div class="grid grid-4">
      ${[
        ['Ümumi müraciət', stats.totalRequests],
        ['Yeni', byStatus.NEW ?? 0],
        ['Baxılır', byStatus.IN_REVIEW ?? 0],
        ['Orta etibarlılıq', stats.averageConfidence == null ? '—' : pct(stats.averageConfidence)],
      ].map(([label, value]) => `
        <article class="card"><div class="card-in">
          <div class="card-head"><span class="card-key">${escapeHtml(label)}</span>
            <span class="dot-blue"></span></div>
          <div class="h-page" style="font-size:2.2rem">${value}</div>
        </div></article>`).join('')}
    </div>

    <div class="grid grid-2 mt-8">
      ${panel('Şöbələr üzrə müraciətlər', stats.byDepartment.length ? `
        <ul class="stack mt-6">
          ${stats.byDepartment.map((d) => `
            <li>
              <div class="row-between">
                <span class="body-p" style="font-size:15px">${escapeHtml(d.name)}</span>
                <span class="meta">${d.count}</span>
              </div>
              <div class="bar mt-4" style="height:5px">
                <span style="width:${(d.count / maxDept) * 100}%"></span>
              </div>
            </li>`).join('')}
        </ul>` : '<p class="body-p mt-4">Hələ müraciət yoxdur.</p>')}

      ${panel('Son 14 gün', stats.volume.length ? `
        <ul class="stack mt-6">
          ${stats.volume.map((v) => `
            <li>
              <div class="row-between">
                <span class="meta">${escapeHtml(v.day)}</span><span class="meta">${v.count}</span>
              </div>
              <div class="bar mt-4" style="height:4px">
                <span style="width:${(v.count / maxVolume) * 100}%"></span></div>
            </li>`).join('')}
        </ul>` : '<p class="body-p mt-4">Son 14 gündə aktivlik yoxdur.</p>')}
    </div>

    ${panel('Aşağı etibarlılıqlı müraciətlər', stats.lowConfidence.length ? `
      <p class="body-p mt-4" style="font-size:15px">Model bu müraciətlərdə əmin olmayıb —
        əl ilə yoxlamaq faydalı ola bilər.</p>
      ${table(['Bilet', 'Şöbə', 'Etibarlılıq', 'Status', 'Mətn'], stats.lowConfidence.map((r) => `
        <tr>
          <td>#${r.ticketNumber}</td>
          <td>${escapeHtml(r.department?.name ?? '—')}</td>
          <td><span class="badge badge-warn">${r.confidence == null ? '—' : pct(r.confidence)}</span></td>
          <td>${escapeHtml(STATUS_LABEL[r.status] ?? r.status)}</td>
          <td>${escapeHtml(r.message.slice(0, 70))}${r.message.length > 70 ? '…' : ''}</td>
        </tr>`).join(''))}`
      : '<p class="body-p mt-4">Aşağı etibarlılıqlı müraciət yoxdur.</p>')}`;

  // The overview panel above is one long template; re-inserting keeps order.
  body.insertAdjacentHTML('beforeend', '');
}

// --- requests ---------------------------------------------------------------

async function renderRequests(body, page = 1) {
  const [data, departments] = await Promise.all([
    api.admin.requests({ page, pageSize: 20 }),
    api.admin.departments(),
  ]);

  body.innerHTML = panel('Bütün müraciətlər', `
    <div class="row mt-6">
      <div class="field" style="min-width:200px">
        <label for="f-dept">Şöbə</label>
        <select class="select" id="f-dept">
          <option value="">Hamısı</option>
          ${departments.items.map((d) =>
            `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="min-width:180px">
        <label for="f-status">Status</label>
        <select class="select" id="f-status">
          <option value="">Hamısı</option>
          <option value="NEW">Yeni</option>
          <option value="IN_REVIEW">Baxılır</option>
          <option value="RESOLVED">Həll edilib</option>
        </select>
      </div>
    </div>
    ${data.items.length
      ? table(['Bilet', 'Tələbə', 'Şöbə', 'Etibarlılıq', 'Status', 'Tarix'],
          data.items.map((r) => `
            <tr>
              <td>#${r.ticketNumber}</td>
              <td>${escapeHtml(r.student?.email ?? '—')}</td>
              <td>${escapeHtml(r.department?.name ?? '—')}</td>
              <td>${r.confidence == null ? '—' : pct(r.confidence)}</td>
              <td><span class="badge ${STATUS_CLASS[r.status] ?? 'badge-neutral'}">
                ${escapeHtml(STATUS_LABEL[r.status] ?? r.status)}</span></td>
              <td>${escapeHtml(formatDateTime(r.createdAt))}</td>
            </tr>`).join(''))
      : '<p class="body-p mt-4">Müraciət tapılmadı.</p>'}
    <nav class="pagination" id="req-pagination"></nav>`);

  const reload = async () => {
    const departmentId = body.querySelector('#f-dept').value;
    const status = body.querySelector('#f-status').value;
    const filtered = await api.admin.requests({
      page: 1, pageSize: 20,
      ...(departmentId ? { departmentId } : {}),
      ...(status ? { status } : {}),
    });
    const tbody = body.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = filtered.items.length
      ? filtered.items.map((r) => `
          <tr>
            <td>#${r.ticketNumber}</td>
            <td>${escapeHtml(r.student?.email ?? '—')}</td>
            <td>${escapeHtml(r.department?.name ?? '—')}</td>
            <td>${r.confidence == null ? '—' : pct(r.confidence)}</td>
            <td><span class="badge ${STATUS_CLASS[r.status] ?? 'badge-neutral'}">
              ${escapeHtml(STATUS_LABEL[r.status] ?? r.status)}</span></td>
            <td>${escapeHtml(formatDateTime(r.createdAt))}</td>
          </tr>`).join('')
      : '<tr><td colspan="6">Müraciət tapılmadı.</td></tr>';
  };
  body.querySelector('#f-dept').addEventListener('change', reload);
  body.querySelector('#f-status').addEventListener('change', reload);

  if (data.items.length) {
    renderPagination(body.querySelector('#req-pagination'), data.pagination,
      (next) => renderRequests(body, next));
  }
}

// --- model ------------------------------------------------------------------

async function renderModel(body) {
  const info = await api.model.info();
  const metrics = info.metrics ?? {};
  const matrix = info.confusionMatrix ?? {};
  const labels = matrix.labels ?? info.labels ?? [];

  body.innerHTML = `
    ${panel('Aktiv model', `
      <div class="grid grid-2 mt-6">
        <div>
          <div class="label-mono">Versiya</div>
          <p class="body-p mt-4">${escapeHtml(info.modelVersion ?? '—')}</p>
          <div class="label-mono mt-6">Alqoritm</div>
          <p class="body-p mt-4">${escapeHtml(info.algorithm ?? '—')}</p>
        </div>
        <div>
          <div class="label-mono">Öyrədilmə tarixi</div>
          <p class="body-p mt-4">${info.trainedAt ? escapeHtml(formatDateTime(info.trainedAt)) : '—'}</p>
          <div class="label-mono mt-6">Dataset</div>
          <p class="body-p mt-4">${info.datasetSize ?? '—'} cümlə
            ${info.trainSize ? `(${info.trainSize} öyrətmə / ${info.testSize} test)` : ''}</p>
        </div>
      </div>
      ${info.source === 'registry'
        ? '<p class="field-hint mt-6">Model xidməti əlçatan deyil — göstəricilər bazadakı qeyddəndir.</p>'
        : ''}`)}

    ${panel('Qiymətləndirmə', `
      <p class="body-p mt-4" style="font-size:15px">Bu rəqəmlər ayrılmış test dəstində ölçülüb.</p>
      <div class="grid grid-4 mt-6">
        ${[
          ['Accuracy', metrics.accuracy],
          ['Precision (macro)', metrics.precisionMacro],
          ['Recall (macro)', metrics.recallMacro],
          ['F1 (macro)', metrics.f1Macro],
        ].map(([label, value]) => `
          <article class="card"><div class="card-in">
            <div class="card-head"><span class="card-key">${escapeHtml(label)}</span>
              <span class="dot-blue"></span></div>
            <div class="h-page" style="font-size:1.9rem">${pct(value)}</div>
          </div></article>`).join('')}
      </div>
      ${metrics.cvAccuracyMean != null ? `
        <p class="body-p mt-6" style="font-size:15px">
          5-fold cross-validation: <strong>${pct(metrics.cvAccuracyMean)}</strong>
          (±${((metrics.cvAccuracyStd ?? 0) * 100).toFixed(1)} bənd) — kiçik test dəsti səbəbindən
          bu daha etibarlı göstəricidir.
        </p>` : ''}`)}

    ${labels.length && matrix.matrix ? panel('Confusion matrix', `
      <p class="body-p mt-4" style="font-size:15px">Sətir = həqiqi şöbə, sütun = modelin təxmini.</p>
      ${table(['', ...labels], (matrix.matrix ?? []).map((row, i) => `
        <tr>
          <td><strong>${escapeHtml(labels[i] ?? '')}</strong></td>
          ${row.map((value, j) => `
            <td style="${i === j ? 'font-weight:700;color:var(--ok)' : value > 0 ? 'color:var(--danger)' : 'opacity:.4'}">
              ${value}</td>`).join('')}
        </tr>`).join(''))}`) : ''}

    ${info.perLabel && Object.keys(info.perLabel).length ? panel('Şöbə üzrə göstəricilər',
      table(['Şöbə', 'Precision', 'Recall', 'F1', 'Test nümunəsi'],
        Object.entries(info.perLabel).map(([name, m]) => `
          <tr>
            <td>${escapeHtml(name)}</td>
            <td>${pct(m.precision)}</td>
            <td>${pct(m.recall)}</td>
            <td>${pct(m.f1)}</td>
            <td>${m.support}</td>
          </tr>`).join(''))) : ''}`;
}

// --- departments ------------------------------------------------------------

async function renderDepartments(body) {
  const { items } = await api.admin.departments();
  body.innerHTML = panel('Şöbələr', `
    <p class="body-p mt-4" style="font-size:15px">Yeni şöbə əlavə etmək olar, lakin model
      onu tanımaq üçün həmin şöbəyə aid nümunələrlə yenidən öyrədilməlidir.</p>

    <details class="mt-6">
      <summary class="btn btn-ghost btn-sm" style="display:inline-flex">Şöbə əlavə et</summary>
      <form id="dept-form" class="grid grid-2 mt-6" novalidate>
        <div class="field"><label for="d-name">Ad</label>
          <input class="input" id="d-name" name="name" required /><span class="field-error"></span></div>
        <div class="field"><label for="d-email">E-poçt</label>
          <input class="input" id="d-email" name="email" type="email" /></div>
        <div class="field" style="grid-column:1/-1"><label for="d-desc">Təsvir</label>
          <textarea class="textarea" id="d-desc" name="description" style="min-height:90px"></textarea></div>
        <button class="btn btn-primary" type="submit" style="grid-column:1/-1">Yarat</button>
      </form>
    </details>

    ${table(['Ad', 'Slug', 'E-poçt', 'Status', 'Əməliyyat'], items.map((d) => `
      <tr>
        <td>${escapeHtml(d.name)}</td>
        <td><span class="meta">${escapeHtml(d.slug)}</span></td>
        <td>${escapeHtml(d.email ?? '—')}</td>
        <td><span class="badge ${d.is_active ? 'badge-ok' : 'badge-neutral'}">
          ${d.is_active ? 'Aktiv' : 'Deaktiv'}</span></td>
        <td><button class="btn btn-ghost btn-sm" data-toggle="${escapeHtml(d.id)}"
                    data-active="${d.is_active}">${d.is_active ? 'Deaktiv et' : 'Aktiv et'}</button></td>
      </tr>`).join(''))}`);

  body.querySelector('#dept-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const created = await api.admin.createDepartment({
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim() || null,
        description: form.elements.description.value.trim(),
      });
      toast(created.retrainingRequired
        ? 'Şöbə yaradıldı — model yenidən öyrədilməlidir'
        : 'Şöbə yaradıldı', 'success');
      renderDepartments(body);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Yaradıla bilmədi.', 'error');
    }
  });

  body.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api.admin.updateDepartment(button.dataset.toggle,
          { isActive: button.dataset.active !== 'true' });
        toast('Şöbə yeniləndi', 'success');
        renderDepartments(body);
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'Yenilənmədi.', 'error');
      }
    });
  });
}

// --- users ------------------------------------------------------------------

async function renderUsers(body, page = 1) {
  const [data, departments] = await Promise.all([
    api.admin.users({ page, pageSize: 20 }),
    api.admin.departments(),
  ]);

  body.innerHTML = panel('İstifadəçilər', `
    <div class="field mt-6" style="max-width:340px">
      <label for="user-search">Axtarış</label>
      <input class="input" id="user-search" type="search" placeholder="E-poçt və ya ad…" />
    </div>
    ${table(['E-poçt', 'Ad', 'Rol', 'Şöbə', 'Status', 'Əməliyyat'], data.items.map((u) => `
      <tr>
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</td>
        <td>
          <select class="select" data-role="${escapeHtml(u.id)}" style="padding:6px 28px 6px 10px;font-size:13px">
            ${['STUDENT', 'DEPARTMENT', 'ADMIN'].map((r) =>
              `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="select" data-dept="${escapeHtml(u.id)}" style="padding:6px 28px 6px 10px;font-size:13px">
            <option value="">—</option>
            ${departments.items.map((d) =>
              `<option value="${escapeHtml(d.id)}" ${u.departmentId === d.id ? 'selected' : ''}>
                ${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </td>
        <td><span class="badge ${u.isActive ? 'badge-ok' : 'badge-danger'}">
          ${u.isActive ? 'Aktiv' : 'Bloklanıb'}</span></td>
        <td><button class="btn btn-ghost btn-sm" data-toggle="${escapeHtml(u.id)}"
                    data-active="${u.isActive}">${u.isActive ? 'Blokla' : 'Aç'}</button></td>
      </tr>`).join(''))}
    <nav class="pagination" id="users-pagination"></nav>`);

  const applyRole = async (id) => {
    const role = body.querySelector(`[data-role="${id}"]`).value;
    const departmentId = body.querySelector(`[data-dept="${id}"]`).value;
    try {
      await api.admin.updateUser(id, { role, ...(role === 'DEPARTMENT' ? { departmentId } : {}) });
      toast('Rol yeniləndi', 'success');
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Rol dəyişdirilmədi.', 'error');
      renderUsers(body, page);
    }
  };
  body.querySelectorAll('[data-role]').forEach((select) => {
    select.addEventListener('change', () => applyRole(select.dataset.role));
  });
  body.querySelectorAll('[data-dept]').forEach((select) => {
    select.addEventListener('change', () => {
      const roleSelect = body.querySelector(`[data-role="${select.dataset.dept}"]`);
      if (roleSelect.value === 'DEPARTMENT') applyRole(select.dataset.dept);
    });
  });

  body.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api.admin.updateUser(button.dataset.toggle,
          { isActive: button.dataset.active !== 'true' });
        toast('İstifadəçi yeniləndi', 'success');
        renderUsers(body, page);
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'Yenilənmədi.', 'error');
      }
    });
  });

  let debounce;
  body.querySelector('#user-search').addEventListener('input', (event) => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const filtered = await api.admin.users({ search: event.target.value.trim(), page: 1, pageSize: 20 });
      const tbody = body.querySelector('tbody');
      tbody.innerHTML = filtered.items.length
        ? filtered.items.map((u) => `
            <tr><td>${escapeHtml(u.email)}</td>
              <td>${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</td>
              <td>${escapeHtml(u.role)}</td>
              <td>${escapeHtml(u.departmentName ?? '—')}</td>
              <td><span class="badge ${u.isActive ? 'badge-ok' : 'badge-danger'}">
                ${u.isActive ? 'Aktiv' : 'Bloklanıb'}</span></td><td></td></tr>`).join('')
        : '<tr><td colspan="6">Nəticə yoxdur.</td></tr>';
    }, 300);
  });

  renderPagination(body.querySelector('#users-pagination'), data.pagination,
    (next) => renderUsers(body, next));
}

// --- contacts / audit -------------------------------------------------------

async function renderContacts(body, page = 1) {
  const data = await api.admin.contacts({ page, pageSize: 20 });
  body.innerHTML = panel('Əlaqə mesajları',
    data.items.length
      ? table(['Tarix', 'Göndərən', 'Mövzu', 'Status', 'Əməliyyat'], data.items.map((c) => `
          <tr>
            <td>${escapeHtml(formatDateTime(c.created_at))}</td>
            <td>${escapeHtml(c.name)}<br><span class="meta">${escapeHtml(c.email)}</span></td>
            <td>${escapeHtml(c.subject)}
              <details><summary class="meta" style="cursor:pointer">Mesajı oxu</summary>
                <p class="body-p mt-4" style="font-size:14px">${escapeHtml(c.message)}</p></details></td>
            <td><span class="badge ${c.status === 'NEW' ? 'badge-warn' : c.status === 'RESOLVED' ? 'badge-ok' : 'badge-neutral'}">
              ${escapeHtml(c.status)}</span></td>
            <td>
              <div class="row" style="gap:6px;flex-wrap:nowrap">
                <button class="btn btn-ghost btn-sm" data-status="READ" data-id="${c.id}">Oxundu</button>
                <button class="btn btn-ghost btn-sm" data-status="RESOLVED" data-id="${c.id}">Bağla</button>
              </div>
            </td>
          </tr>`).join('')) + '<nav class="pagination" id="contact-pagination"></nav>'
      : '<p class="body-p mt-4">Mesaj yoxdur.</p>');

  body.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api.admin.updateContact(button.dataset.id, { status: button.dataset.status });
        toast('Mesaj yeniləndi', 'success');
        renderContacts(body, page);
      } catch (error) {
        toast(error instanceof ApiError ? error.message : 'Yenilənmədi.', 'error');
      }
    });
  });

  if (data.items.length) {
    renderPagination(body.querySelector('#contact-pagination'), data.pagination,
      (next) => renderContacts(body, next));
  }
}

async function renderAudit(body, page = 1) {
  const data = await api.admin.audit({ page, pageSize: 25 });
  body.innerHTML = panel('Audit jurnalı',
    data.items.length
      ? table(['Vaxt', 'İstifadəçi', 'Əməliyyat', 'Resurs', 'IP'], data.items.map((a) => `
          <tr>
            <td>${escapeHtml(formatDateTime(a.created_at))}</td>
            <td>${escapeHtml(a.user_email || 'system')}</td>
            <td><span class="badge badge-neutral">${escapeHtml(a.action)}</span></td>
            <td><span class="meta">${escapeHtml(a.resource)}</span></td>
            <td><span class="meta">${escapeHtml(a.ip_address || '—')}</span></td>
          </tr>`).join('')) + '<nav class="pagination" id="audit-pagination"></nav>'
      : '<p class="body-p mt-4">Qeyd yoxdur.</p>');

  if (data.items.length) {
    renderPagination(body.querySelector('#audit-pagination'), data.pagination,
      (next) => renderAudit(body, next));
  }
}

shell();
