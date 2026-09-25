import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { clearCachedUser, currentUser, homeFor } from './auth.js';
import { setLoading, toast } from './ui.js';
import { applyServerErrors, rules, validateForm } from './validation.js';

await mountShell();
const existing = await currentUser();
if (existing) location.replace(homeFor(existing.role));

const form = document.getElementById('auth-form');
const button = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');

// Live feedback on the password field as the user types.
form.elements.password.addEventListener('input', () => {
  const message = rules.password(form.elements.password.value);
  const slot = form.elements.password.closest('.field').querySelector('.field-error');
  slot.textContent = form.elements.password.value ? (message || '') : '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';

  const ok = validateForm(form, {
    firstName: rules.required('Ad'),
    lastName: rules.required('Soyad'),
    email: rules.email,
    password: rules.password,
  });
  if (!ok) return;

  setLoading(button, true);
  try {
    await api.auth.register({
      firstName: form.elements.firstName.value.trim(),
      lastName: form.elements.lastName.value.trim(),
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
    });
    clearCachedUser();
    toast('Hesab yaradıldı', 'success');
    location.href = '/classifier';
  } catch (error) {
    if (error instanceof ApiError) {
      if (!applyServerErrors(form, error)) formError.textContent = error.message;
    } else {
      formError.textContent = 'Gözlənilməz xəta. Yenidən cəhd edin.';
    }
  } finally {
    setLoading(button, false);
  }
});
