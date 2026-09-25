import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { currentUser } from './auth.js';
import { escapeHtml, observeReveals, setLoading, toast } from './ui.js';
import { setFieldError } from './validation.js';

/**
 * The core page: a student writes a message, the trained model classifies it,
 * and the routed ticket is created. Every number shown here comes from the
 * API response — nothing is simulated on the client.
 */

await mountShell();

const form = document.getElementById('classify-form');
const textarea = document.getElementById('message');
const button = document.getElementById('submit-btn');
const counter = document.getElementById('char-count');
const stateLine = document.getElementById('classifier-state');
const result = document.getElementById('result');

const MIN = 10;
const MAX = 4000;

const EXAMPLES = [
  'Təhsil haqqımın ödənişi ilə bağlı problem yaşayıram.',
  'Kitabxanadan götürdüyüm kitabı sistemdə qaytara bilmirəm.',
  'Wi-Fi işləmədiyi üçün portala daxil ola bilmirəm.',
  'İmtahan nəticəmlə bağlı müraciət etmək istəyirəm.',
];

// --- example chips ----------------------------------------------------------

const examplesBox = document.getElementById('examples');
for (const example of EXAMPLES) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = example;
  chip.addEventListener('click', () => {
    textarea.value = example;
    textarea.dispatchEvent(new Event('input'));
    textarea.focus();
  });
  examplesBox.append(chip);
}

// --- live character count ---------------------------------------------------

const updateCount = () => {
  const length = textarea.value.trim().length;
  counter.textContent = String(length);
  counter.style.color = length > MAX ? 'var(--danger)' : '';
};
textarea.addEventListener('input', () => {
  updateCount();
  setFieldError(textarea, null);
});
updateCount();

// --- classifier availability -----------------------------------------------

// If the Python service is down, say so before the student types a paragraph
// and loses it to a 503.
try {
  const health = await api.model.health();
  if (!health.classifierAvailable) {
    stateLine.textContent = 'Təsnifat xidməti əlçatan deyil';
    stateLine.style.color = 'var(--danger)';
  }
} catch {
  /* non-blocking */
}

// --- submit -----------------------------------------------------------------

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const message = textarea.value.trim();
  if (message.length < MIN) {
    setFieldError(textarea, `Müraciət ən azı ${MIN} simvol olmalıdır`);
    textarea.focus();
    return;
  }
  if (message.length > MAX) {
    setFieldError(textarea, `Müraciət ${MAX} simvoldan uzun ola bilməz`);
    textarea.focus();
    return;
  }

  // Submitting requires an account, because the ticket belongs to someone.
  if (!(await currentUser())) {
    sessionStorage.setItem('deptify.draft', message);
    location.href = '/login?next=%2Fclassifier';
    return;
  }

  setLoading(button, true);
  stateLine.textContent = 'Mətn təhlil olunur…';
  stateLine.style.color = '';
  result.innerHTML = `
    <div class="state" role="status">
      <div class="spinner"></div>
      <div class="label-mono">Təsnifat aparılır</div>
    </div>`;

  try {
    const { request } = await api.requests.create({ message });
    renderResult(request);
    form.reset();
    updateCount();
    stateLine.textContent = '';
  } catch (error) {
    result.innerHTML = '';
    const apiError = error instanceof ApiError ? error : null;
    stateLine.textContent = '';

    if (apiError?.status === 401) {
      sessionStorage.setItem('deptify.draft', message);
      location.href = '/login?next=%2Fclassifier';
      return;
    }
    result.innerHTML = `
      <div class="state" role="alert">
        <div class="label-mono">Müraciət göndərilmədi</div>
        <p>${escapeHtml(apiError?.message ?? 'Gözlənilməz xəta baş verdi.')}</p>
        ${apiError?.code === 'CLASSIFIER_UNAVAILABLE'
          ? '<p class="field-hint">Model xidməti işləmir. Terminalda <code>npm run ml:serve</code> işə salın.</p>'
          : ''}
        <button class="btn btn-ghost" id="retry-btn">Yenidən cəhd et</button>
      </div>`;
    document.getElementById('retry-btn')?.addEventListener('click', () => {
      textarea.value = message;
      updateCount();
      form.requestSubmit();
    });
    if (apiError) toast(apiError.message, 'error');
  } finally {
    setLoading(button, false);
  }
});

// --- result -----------------------------------------------------------------

function renderResult(request) {
  const confidencePercent = Math.round((request.confidence ?? 0) * 1000) / 10;
  // The model's full distribution, minus the winning label.
  const alternatives = (request.probabilities ?? []).slice(1);
  const lowConfidence = confidencePercent < 50;

  result.innerHTML = `
    <section class="panel reveal">
      <div class="row-between">
        <div>
          <div class="label-mono">[ Yönləndirildi ]</div>
          <h2 class="h-page" style="font-size:2.4rem;margin-top:14px">
            ${escapeHtml(request.department?.name ?? '—')}
          </h2>
          <p class="meta" style="margin-top:8px">Bilet #${request.ticketNumber}</p>
        </div>
        <div style="text-align:right">
          <div class="h-page" style="font-size:3rem">${confidencePercent}%</div>
          <div class="meta">Etibarlılıq</div>
        </div>
      </div>

      <div class="bar mt-6"><span style="width:${confidencePercent}%"></span></div>

      ${lowConfidence ? `
        <div class="mt-6" style="padding:14px 16px;border-radius:.9rem;background:rgba(154,103,0,.08);border:1px solid rgba(154,103,0,.25)">
          <p class="body-p" style="font-size:14px;color:var(--warn)">
            Model bu müraciətdə əmin deyil. Müraciətiniz yenə də göndərildi, lakin şöbə onu
            başqa şöbəyə yönləndirə bilər.
          </p>
        </div>` : ''}

      <div class="mt-8">
        <div class="label-mono">[ Göndərdiyiniz mətn ]</div>
        <p class="body-p mt-4" style="font-size:15px">${escapeHtml(request.message)}</p>
      </div>

      ${alternatives.length ? `
        <div class="mt-8">
          <div class="label-mono">[ Digər ehtimallar ]</div>
          <ul class="stack mt-4">
            ${alternatives.map((p, i) => `
              <li>
                <div class="row-between">
                  <span class="body-p" style="font-size:14px">${i + 2}. ${escapeHtml(p.label)}</span>
                  <span class="meta">${(p.probability * 100).toFixed(1)}%</span>
                </div>
                <div class="bar mt-4" style="height:4px">
                  <span style="width:${p.probability * 100}%"></span>
                </div>
              </li>`).join('')}
          </ul>
        </div>` : ''}

      <div class="row-between mt-8">
        <span class="meta">Model ${escapeHtml(request.modelVersion ?? '—')}</span>
        <span class="badge badge-warn">${escapeHtml(request.status)}</span>
      </div>

      <div class="row mt-6">
        <a class="btn btn-primary" href="/requests">Müraciətlərim</a>
        <button class="btn btn-ghost" id="another-btn">Yeni müraciət yaz</button>
      </div>
    </section>`;

  observeReveals(result);
  result.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('another-btn')?.addEventListener('click', () => {
    result.innerHTML = '';
    textarea.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// Restore a draft the student lost to the login redirect.
const draft = sessionStorage.getItem('deptify.draft');
if (draft) {
  textarea.value = draft;
  sessionStorage.removeItem('deptify.draft');
  updateCount();
}
