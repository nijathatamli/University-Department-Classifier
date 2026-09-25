/**
 * Frontend validation — UX only.
 *
 * These rules mirror server/src/lib/validation.ts so users get immediate
 * feedback, but the backend re-validates everything: this file is never the
 * security boundary.
 */
export const rules = {
  email: (v) => (!v ? 'E-poçt tələb olunur'
    : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? 'Düzgün e-poçt ünvanı daxil edin' : null),

  password: (v) => (!v ? 'Şifrə tələb olunur'
    : v.length < 8 ? 'Şifrə ən azı 8 simvol olmalıdır'
    : !/[a-z]/.test(v) || !/[A-Z]/.test(v) || !/\d/.test(v)
      ? 'Böyük hərf, kiçik hərf və rəqəm olmalıdır'
      : null),

  required: (label) => (v) => (!v || !String(v).trim() ? `${label} tələb olunur` : null),

  minLength: (label, n) => (v) =>
    (v && String(v).trim().length < n ? `${label} ən azı ${n} simvol olmalıdır` : null),

  range: (label, min, max) => (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return `${label} rəqəm olmalıdır`;
    if (n < min || n > max) return `${label} ${min} ilə ${max} arasında olmalıdır`;
    return null;
  },
};

export const FIELD_RANGES = {
  gpa: [0, 4],
  satScore: [400, 1600],
  ieltsScore: [0, 9],
  subject: [0, 100],
  age: [14, 100],
};

/** Shows or clears an inline error under a field and sets aria-invalid. */
export function setFieldError(input, message) {
  if (!input) return;
  const wrap = input.closest('.field');
  const slot = wrap?.querySelector('.field-error');
  if (slot) slot.textContent = message || '';
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (message) {
    input.setAttribute('aria-describedby', slot?.id || '');
  }
}

export function clearErrors(form) {
  form.querySelectorAll('.field-error').forEach((n) => { n.textContent = ''; });
  form.querySelectorAll('[aria-invalid="true"]').forEach((n) => n.setAttribute('aria-invalid', 'false'));
}

/**
 * Runs a {field: validatorFn} map over a form.
 * Returns true when valid; focuses and reports the first failure otherwise.
 */
export function validateForm(form, schema) {
  clearErrors(form);
  let firstBad = null;
  for (const [name, validator] of Object.entries(schema)) {
    const input = form.elements[name];
    if (!input) continue;
    const message = validator(input.value);
    if (message) {
      setFieldError(input, message);
      if (!firstBad) firstBad = input;
    }
  }
  firstBad?.focus();
  return !firstBad;
}

/** Maps a backend ApiError's field errors onto the form inputs. */
export function applyServerErrors(form, apiError) {
  const fields = apiError?.fields || {};
  let first = null;
  for (const [name, message] of Object.entries(fields)) {
    const input = form.elements[name];
    if (!input) continue;
    setFieldError(input, message);
    if (!first) first = input;
  }
  first?.focus();
  return Boolean(first);
}
