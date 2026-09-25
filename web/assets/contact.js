import { mountShell } from './shell.js';
import { api, ApiError } from './api.js';
import { escapeHtml, setLoading, toast } from './ui.js';
import { applyServerErrors, rules, validateForm } from './validation.js';

await mountShell();

const form = document.getElementById('contact-form');
const button = document.getElementById('submit-btn');
const success = document.getElementById('contact-success');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const ok = validateForm(form, {
    name: rules.minLength('Ad', 2),
    email: rules.email,
    subject: rules.minLength('Mövzu', 3),
    message: rules.minLength('Mesaj', 10),
  });
  if (!ok) return;

  setLoading(button, true);
  try {
    const result = await api.contact.send({
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      subject: form.elements.subject.value.trim(),
      message: form.elements.message.value.trim(),
    });
    form.hidden = true;
    success.hidden = false;
    success.innerHTML = `
      <div class="state">
        <div class="label-mono">Mesaj göndərildi</div>
        <p>${escapeHtml(result.message)}</p>
        <a class="btn btn-ghost" href="/">Ana səhifəyə qayıt</a>
      </div>`;
  } catch (error) {
    if (error instanceof ApiError) {
      if (!applyServerErrors(form, error)) toast(error.message, 'error');
      if (error.status === 429) toast('Çox sayda mesaj göndərildi. Bir az sonra yenidən cəhd edin.', 'error');
    } else {
      toast('Mesaj göndərilmədi. Yenidən cəhd edin.', 'error');
    }
  } finally {
    setLoading(button, false);
  }
});
