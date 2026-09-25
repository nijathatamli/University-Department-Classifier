import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { clearCachedUser, currentUser, homeFor } from './auth.js';
import { setLoading, toast } from './ui.js';
import { applyServerErrors, rules, validateForm } from './validation.js';

await mountShell();

// Already signed in? Go straight through.
const existing = await currentUser();
if (existing) {
  location.replace(new URLSearchParams(location.search).get('next') || homeFor(existing.role));
}

const form = document.getElementById('auth-form');
const button = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';

  if (!validateForm(form, { email: rules.email, password: rules.required('Şifrə') })) return;

  setLoading(button, true);
  try {
    const { user } = await api.auth.login({
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
    });
    clearCachedUser();
    const next = new URLSearchParams(location.search).get('next');
    // Only allow same-origin redirects, so ?next= cannot send users off-site.
    location.href = next && next.startsWith('/') && !next.startsWith('//')
      ? next
      : homeFor(user.role);
  } catch (error) {
    if (error instanceof ApiError) {
      if (!applyServerErrors(form, error)) formError.textContent = error.message;
    } else {
      formError.textContent = 'Gözlənilməz xəta. Yenidən cəhd edin.';
    }
    toast('Daxil ola bilmədiniz', 'error');
  } finally {
    setLoading(button, false);
  }
});
