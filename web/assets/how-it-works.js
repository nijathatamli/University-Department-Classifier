import { mountShell } from './shell.js';
import { api } from './api.js';
import { escapeHtml, observeReveals } from './ui.js';

await mountShell();
observeReveals();

/**
 * Shows the live model metrics on the "how it works" page. Shared with the
 * about page, where the metrics block simply does not exist.
 */
const box = document.getElementById('live-metrics');
if (box) {
  const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
  try {
    const info = await api.model.info();
    const m = info.metrics ?? {};
    box.innerHTML = `
      <div class="grid grid-4">
        ${[
          ['Accuracy', m.accuracy],
          ['Precision', m.precisionMacro],
          ['Recall', m.recallMacro],
          ['F1', m.f1Macro],
        ].map(([label, value]) => `
          <article class="card"><div class="card-in">
            <div class="card-head"><span class="card-key">${escapeHtml(label)}</span>
              <span class="dot-blue"></span></div>
            <div class="h-page" style="font-size:1.8rem">${pct(value)}</div>
          </div></article>`).join('')}
      </div>
      <p class="body-p mt-6" style="font-size:15px">
        Model <strong>${escapeHtml(info.modelVersion ?? '—')}</strong> ·
        ${escapeHtml(info.algorithm ?? '—')} ·
        ${info.datasetSize ?? '—'} cümləlik dataset.
        ${m.cvAccuracyMean != null
          ? `5-fold cross-validation: <strong>${pct(m.cvAccuracyMean)}</strong>.`
          : ''}
      </p>`;
  } catch {
    box.innerHTML = '<p class="body-p">Model göstəriciləri hazırda əlçatan deyil.</p>';
  }
}
