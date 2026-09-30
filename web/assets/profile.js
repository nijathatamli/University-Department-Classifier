import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { clearCachedUser, logout, requireUser } from './auth.js';
import {
  confirmDialog, escapeHtml, formatDateTime, observeReveals,
  renderError, renderLoading, setLoading, toast,
} from './ui.js';
import { applyServerErrors, clearErrors, rules, setFieldError, validateForm } from './validation.js';

/**
 * The signed-in user's own account.
 *
 * States handled: loading, loaded, edit, saving, success, validation error,
 * API error, and an incomplete-profile prompt. Nothing is reported as saved
 * until the backend confirms it — the form re-renders from the PATCH response,
 * which the server builds by re-reading the database.
 */

await mountShell();
const user = await requireUser();
if (!user) throw new Error('redirecting');

const root = document.getElementById('profile-root');

const ROLE_LABEL = { STUDENT: 'Tələbə', DEPARTMENT: 'Şöbə əməkdaşı', ADMIN: 'Administrator' };

let data = null;
let editing = false;

// --- load -------------------------------------------------------------------

async function load() {
  renderLoading(root, 'Profil yüklənir');
  try {
    data = await api.profile.get();
    render();
  } catch (error) {
    renderError(root, error instanceof ApiError ? error.message : 'Profil yüklənmədi.', load);
  }
}

// --- render -----------------------------------------------------------------

const initials = (p) =>
  `${(p.firstName ?? '').charAt(0)}${(p.lastName ?? '').charAt(0)}`.toUpperCase() || '—';

const readonlyRow = (label, value) => `
  <div class="row-between" style="padding:11px 0;border-bottom:1px solid rgba(0,0,0,.05)">
    <span class="meta">${escapeHtml(label)}</span>
    <span class="body-p" style="font-size:15px">${escapeHtml(value)}</span>
  </div>`;

function render() {
  const p = data.profile;
  const completion = data.completion;

  root.innerHTML = `
    <section class="page-head reveal">
      <div class="label-mono">[ Profil ]</div>
      <h1 class="h-page">Hesabınız.</h1>
      <p class="body-p">Şəxsi məlumatlarınızı və hesab təhlükəsizliyinizi buradan idarə edin.</p>
    </section>

    <section class="panel reveal">
      <div class="row-between">
        <div class="row" style="gap:16px;flex-wrap:nowrap">
          <span aria-hidden="true" style="
            width:64px;height:64px;border-radius:9999px;flex:none;
            display:flex;align-items:center;justify-content:center;
            background:var(--orb);color:#fff;
            font-family:var(--font-display);font-weight:700;font-size:20px;letter-spacing:.06em">
            ${escapeHtml(initials(p))}
          </span>
          <span>
            <h2 class="h-section">${escapeHtml(`${p.firstName} ${p.lastName}`)}</h2>
            <p class="meta" style="margin-top:6px">${escapeHtml(p.email)}</p>
          </span>
        </div>
        <div class="row" style="gap:8px">
          <span class="badge ${p.isActive ? 'badge-ok' : 'badge-danger'}">
            ${p.isActive ? 'Aktiv hesab' : 'Bloklanıb'}</span>
          <span class="badge">${escapeHtml(ROLE_LABEL[p.role] ?? p.role)}</span>
        </div>
      </div>

      <div class="row-between mt-8">
        <span class="meta">Profilin doldurulması</span>
        <span class="meta">${completion}%</span>
      </div>
      <div class="bar mt-4"><span style="width:${completion}%"></span></div>

      ${completion < 100 ? `
        <p class="field-hint mt-4">
          Telefon və tələbə nömrənizi əlavə etsəniz, şöbə sizinlə daha tez əlaqə saxlaya bilər.
        </p>` : ''}
    </section>

    <section class="panel mt-8 reveal">
      <div class="row-between">
        <h2 class="h-section">Şəxsi məlumatlar</h2>
        ${editing ? '' : '<button class="btn btn-ghost btn-sm" id="edit-btn">Redaktə et</button>'}
      </div>
      <div id="personal" class="mt-6"></div>
    </section>

    <section class="panel mt-8 reveal">
      <h2 class="h-section">Hesab məlumatı</h2>
      <div class="mt-6">
        ${readonlyRow('Rol', ROLE_LABEL[p.role] ?? p.role)}
        ${p.departmentName ? readonlyRow('Şöbə', p.departmentName) : ''}
        ${readonlyRow('Hesab yaradılıb', formatDateTime(p.createdAt))}
        ${readonlyRow('Son yenilənmə', formatDateTime(p.updatedAt))}
      </div>
    </section>

    <section class="panel mt-8 reveal">
      <h2 class="h-section">Təhlükəsizlik</h2>
      <p class="body-p mt-4" style="font-size:15px">
        Şifrənizi dəyişmək üçün cari şifrənizi təsdiqləməlisiniz.
      </p>
      <div class="row mt-6">
        <button class="btn btn-ghost btn-sm" id="password-btn">Şifrəni dəyiş</button>
        <button class="btn btn-danger btn-sm" id="logout-profile-btn">Çıxış et</button>
      </div>
      <div id="password-area" class="mt-6"></div>
    </section>`;

  renderPersonal();
  observeReveals(root);

  document.getElementById('edit-btn')?.addEventListener('click', () => {
    editing = true;
    renderPersonal();
    document.getElementById('firstName')?.focus();
  });

  document.getElementById('password-btn').addEventListener('click', togglePasswordForm);
  document.getElementById('logout-profile-btn').addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: 'Çıxış etmək istəyirsiniz?',
      message: 'Sessiyanız bağlanacaq və yenidən daxil olmalı olacaqsınız.',
      confirmLabel: 'Çıxış et', danger: true,
    });
    if (confirmed) await logout();
  });
}

// --- personal information: view + edit --------------------------------------

function renderPersonal() {
  const box = document.getElementById('personal');
  const p = data.profile;

  if (!editing) {
    box.innerHTML = `
      ${readonlyRow('Ad', p.firstName)}
      ${readonlyRow('Soyad', p.lastName)}
      ${readonlyRow('E-poçt', p.email)}
      ${readonlyRow('Telefon', p.phone || 'Əlavə edilməyib')}
      ${readonlyRow('Tələbə nömrəsi', p.studentId || 'Əlavə edilməyib')}`;
    return;
  }

  box.innerHTML = `
    <form id="profile-form" novalidate>
      <div class="grid grid-2">
        <div class="field">
          <label for="firstName">Ad</label>
          <input class="input" id="firstName" name="firstName" autocomplete="given-name"
                 value="${escapeHtml(p.firstName ?? '')}" required />
          <span class="field-error"></span>
        </div>
        <div class="field">
          <label for="lastName">Soyad</label>
          <input class="input" id="lastName" name="lastName" autocomplete="family-name"
                 value="${escapeHtml(p.lastName ?? '')}" required />
          <span class="field-error"></span>
        </div>
        <div class="field">
          <label for="email">E-poçt</label>
          <input class="input" id="email" name="email" value="${escapeHtml(p.email)}" disabled />
          <span class="field-hint">E-poçt hesabınızın identifikatorudur və dəyişdirilə bilməz.</span>
        </div>
        <div class="field">
          <label for="phone">Telefon <span style="text-transform:none">(istəyə bağlı)</span></label>
          <input class="input" id="phone" name="phone" type="tel" autocomplete="tel"
                 placeholder="+994 55 123 45 67" value="${escapeHtml(p.phone ?? '')}" />
          <span class="field-error"></span>
        </div>
        <div class="field">
          <label for="studentId">Tələbə nömrəsi <span style="text-transform:none">(istəyə bağlı)</span></label>
          <input class="input" id="studentId" name="studentId" placeholder="ST-2024-0117"
                 value="${escapeHtml(p.studentId ?? '')}" />
          <span class="field-error"></span>
        </div>
      </div>

      <div id="form-error" class="field-error mt-4" role="alert"></div>

      <div class="row mt-6">
        <button class="btn btn-primary" type="submit" id="save-btn">Yadda saxla</button>
        <button class="btn btn-ghost" type="button" id="cancel-btn">Ləğv et</button>
      </div>
    </form>`;

  const form = document.getElementById('profile-form');
  const saveBtn = document.getElementById('save-btn');
  const formError = document.getElementById('form-error');

  document.getElementById('cancel-btn').addEventListener('click', () => {
    editing = false;
    renderPersonal();
    document.getElementById('edit-btn')?.focus();
  });

  // Clear a field's error as soon as the user starts correcting it.
  form.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => setFieldError(input, null));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    formError.textContent = '';

    const ok = validateForm(form, {
      firstName: rules.required('Ad'),
      lastName: rules.required('Soyad'),
    });
    if (!ok) return;

    const phone = form.elements.phone.value.trim();
    const studentId = form.elements.studentId.value.trim();

    // Mirrors the server rules so the user gets the message without a round trip.
    if (phone && !/^[+0-9 ()\-]{6,24}$/.test(phone)) {
      setFieldError(form.elements.phone, 'Yalnız rəqəm, boşluq və + ( ) - simvolları');
      form.elements.phone.focus();
      return;
    }
    if (studentId && !/^[A-Za-z0-9\-/]{3,32}$/.test(studentId)) {
      setFieldError(form.elements.studentId, 'Yalnız hərf, rəqəm, - və / simvolları (3–32)');
      form.elements.studentId.focus();
      return;
    }

    setLoading(saveBtn, true);
    try {
      // The response is rebuilt from the database, so what we render next is
      // what was actually stored.
      data = await api.profile.update({
        firstName: form.elements.firstName.value.trim(),
        lastName: form.elements.lastName.value.trim(),
        phone,
        studentId,
      });
      editing = false;
      clearCachedUser();   // the header greets the user by first name
      render();
      toast('Profil yeniləndi', 'success');
    } catch (error) {
      if (error instanceof ApiError) {
        if (!applyServerErrors(form, error)) formError.textContent = error.message;
      } else {
        formError.textContent = 'Gözlənilməz xəta. Yenidən cəhd edin.';
      }
      setLoading(saveBtn, false);
    }
  });
}

// --- change password --------------------------------------------------------

function togglePasswordForm() {
  const area = document.getElementById('password-area');
  const trigger = document.getElementById('password-btn');

  if (area.dataset.open === 'true') {
    area.innerHTML = '';
    area.dataset.open = 'false';
    trigger.textContent = 'Şifrəni dəyiş';
    return;
  }

  area.dataset.open = 'true';
  trigger.textContent = 'Bağla';
  area.innerHTML = `
    <form id="password-form" class="stack" style="max-width:460px" novalidate>
      <div class="field">
        <label for="currentPassword">Cari şifrə</label>
        <input class="input" id="currentPassword" name="currentPassword" type="password"
               autocomplete="current-password" required />
        <span class="field-error"></span>
      </div>
      <div class="field">
        <label for="newPassword">Yeni şifrə</label>
        <input class="input" id="newPassword" name="newPassword" type="password"
               autocomplete="new-password" required />
        <span class="field-error"></span>
        <span class="field-hint">Ən azı 8 simvol, böyük və kiçik hərf, rəqəm.</span>
      </div>
      <div class="field">
        <label for="confirmPassword">Yeni şifrə (təkrar)</label>
        <input class="input" id="confirmPassword" name="confirmPassword" type="password"
               autocomplete="new-password" required />
        <span class="field-error"></span>
      </div>
      <div id="password-error" class="field-error" role="alert"></div>
      <div class="row">
        <button class="btn btn-primary" type="submit" id="password-save">Şifrəni yenilə</button>
      </div>
    </form>`;

  const form = document.getElementById('password-form');
  const saveBtn = document.getElementById('password-save');
  const formError = document.getElementById('password-error');

  form.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => setFieldError(input, null));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    formError.textContent = '';

    const ok = validateForm(form, {
      currentPassword: rules.required('Cari şifrə'),
      newPassword: rules.password,
    });
    if (!ok) return;

    if (form.elements.newPassword.value !== form.elements.confirmPassword.value) {
      setFieldError(form.elements.confirmPassword, 'Şifrələr uyğun gəlmir');
      form.elements.confirmPassword.focus();
      return;
    }

    setLoading(saveBtn, true);
    try {
      await api.auth.changePassword({
        currentPassword: form.elements.currentPassword.value,
        newPassword: form.elements.newPassword.value,
      });
      togglePasswordForm();
      toast('Şifrəniz yeniləndi', 'success');
      await load();
    } catch (error) {
      if (error instanceof ApiError) {
        if (!applyServerErrors(form, error)) formError.textContent = error.message;
        if (error.status === 429) {
          formError.textContent = 'Çox sayda cəhd. Bir az sonra yenidən sınayın.';
        }
      } else {
        formError.textContent = 'Gözlənilməz xəta. Yenidən cəhd edin.';
      }
      setLoading(saveBtn, false);
    }
  });

  document.getElementById('currentPassword').focus();
}

await load();
