import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { setLoading, toast } from './ui.js';
import { applyServerErrors, rules, validateForm } from './validation.js';

await mountShell();

const form = document.getElementById('auth-form');
const button = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');

// Prefill from ?token= so the link in the email is a single click.
const token = new URLSearchParams(location.search).get('token');
if (token) form.elements.token.value = token;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';
  const ok = validateForm(form, {
    token: rules.required('Bərpa kodu'),
    password: rules.password,
  });
  if (!ok) return;

  setLoading(button, true);
  try {
    await api.auth.resetPassword({
      token: form.elements.token.value.trim(),
      password: form.elements.password.value,
    });
    toast('Şifrə yeniləndi — indi daxil ola bilərsiniz', 'success');
    location.href = '/login';
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
