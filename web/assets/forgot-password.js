import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { escapeHtml, setLoading } from './ui.js';
import { rules, validateForm } from './validation.js';

await mountShell();

const form = document.getElementById('auth-form');
const button = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');
const sent = document.getElementById('reset-sent');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.textContent = '';
  if (!validateForm(form, { email: rules.email })) return;

  setLoading(button, true);
  try {
    const result = await api.auth.forgotPassword({ email: form.elements.email.value.trim() });
    sent.hidden = false;
    // The API deliberately answers identically whether or not the account
    // exists, so this message never reveals which emails are registered.
    sent.innerHTML = `<p class="body-p" style="font-size:14px">${escapeHtml(result.message)}</p>` +
      (result.devToken
        ? `<p class="field-hint mt-4">Development mode: no mail service is configured, so use this
             token directly — <a style="text-decoration:underline"
             href="/reset-password?token=${encodeURIComponent(result.devToken)}">continue to reset</a>.</p>`
        : '');
    form.elements.email.value = '';
  } catch (error) {
    formError.textContent = error instanceof ApiError ? error.message : 'Gözlənilməz xəta.';
  } finally {
    setLoading(button, false);
  }
});
