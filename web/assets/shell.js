import { currentUser, logout } from './auth.js';
import { escapeHtml, observeReveals } from './ui.js';

/**
 * Renders the header and footer used by every page except the landing page
 * (which stays self-contained). Defining the chrome once is what keeps the
 * whole product on one design system.
 */

const LANG_KEY = 'deptify.lang'; // same key the landing page writes
const LANGS = ['az', 'en', 'ru'];

/**
 * Chrome-level translations only. The landing page is fully trilingual; the
 * application pages currently ship English body copy, so translating the shared
 * navigation and footer keeps the language choice visibly consistent across the
 * whole site. See README "Known gaps" before extending this.
 */
const CHROME_I18N = {
  az: {
    nav: { classifier: 'Müraciət göndər', requests: 'Müraciətlərim', how: 'Necə işləyir', about: 'Haqqımızda', contact: 'Əlaqə' },
    queue: 'Şöbə paneli', admin: 'Admin', signIn: 'Daxil ol', signOut: 'Çıxış', start: 'Müraciət göndər',
    footerLabel: '[ Müraciətiniz var? ]', footerHead: 'Yazın —<br>biz yönləndirək.', footerCta: 'Müraciət göndər',
    copy: '© 2026 Tələbə Müraciətlərinin Avtomatik Yönləndirilməsi — Bütün hüquqlar qorunur.',
    cols: [
      { title: 'Müraciət', links: [['Müraciət göndər', '/classifier'], ['Müraciətlərim', '/requests'], ['Necə işləyir', '/how-it-works']] },
      { title: 'Şöbələr', links: [['Dekanat', '/how-it-works'], ['Maliyyə', '/how-it-works'], ['Kitabxana', '/how-it-works'], ['İT Dəstək', '/how-it-works']] },
      { title: 'Layihə', links: [['Haqqımızda', '/about'], ['Model', '/how-it-works'], ['Əlaqə', '/contact']] },
    ],
  },
  en: {
    nav: { classifier: 'Submit request', requests: 'My requests', how: 'How it works', about: 'About', contact: 'Contact' },
    queue: 'Department', admin: 'Admin', signIn: 'Sign in', signOut: 'Sign out', start: 'Submit request',
    footerLabel: '[ Got a request? ]', footerHead: 'Write it —<br>we route it.', footerCta: 'Submit request',
    copy: '© 2026 Student Request Routing — All rights reserved.',
    cols: [
      { title: 'Requests', links: [['Submit request', '/classifier'], ['My requests', '/requests'], ['How it works', '/how-it-works']] },
      { title: 'Departments', links: [['Dekanat', '/how-it-works'], ['Maliyyə', '/how-it-works'], ['Kitabxana', '/how-it-works'], ['İT Dəstək', '/how-it-works']] },
      { title: 'Project', links: [['About', '/about'], ['Model', '/how-it-works'], ['Contact', '/contact']] },
    ],
  },
  ru: {
    nav: { classifier: 'Отправить обращение', requests: 'Мои обращения', how: 'Как это работает', about: 'О проекте', contact: 'Контакты' },
    queue: 'Отдел', admin: 'Админ', signIn: 'Войти', signOut: 'Выйти', start: 'Отправить обращение',
    footerLabel: '[ Есть обращение? ]', footerHead: 'Напишите —<br>мы направим.', footerCta: 'Отправить обращение',
    copy: '© 2026 Автоматическая маршрутизация обращений — Все права защищены.',
    cols: [
      { title: 'Обращения', links: [['Отправить', '/classifier'], ['Мои обращения', '/requests'], ['Как это работает', '/how-it-works']] },
      { title: 'Отделы', links: [['Dekanat', '/how-it-works'], ['Maliyyə', '/how-it-works'], ['Kitabxana', '/how-it-works'], ['İT Dəstək', '/how-it-works']] },
      { title: 'Проект', links: [['О проекте', '/about'], ['Модель', '/how-it-works'], ['Контакты', '/contact']] },
    ],
  },
};

function readLang() {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && LANGS.includes(stored)) return stored;
  } catch { /* storage blocked */ }
  return 'az'; // matches the landing page default
}

const ICON = {
  arrowUpRight: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>',
  chevronRight: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  menu: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};

let lang = readLang();
const t = () => CHROME_I18N[lang] || CHROME_I18N.en;

function navItems(user) {
  const d = t();
  const items = [
    [d.nav.classifier, '/classifier'],
    [d.nav.how, '/how-it-works'],
    [d.nav.about, '/about'],
    [d.nav.contact, '/contact'],
  ];
  // Students get their own history; staff get their queue; admins get both.
  if (user?.role === 'STUDENT') items.splice(1, 0, [d.nav.requests, '/requests']);
  if (user?.role === 'DEPARTMENT') items.unshift([d.queue, '/department']);
  if (user?.role === 'ADMIN') items.unshift([d.admin, '/admin']);
  return items;
}

function renderHeader(user) {
  const d = t();
  const here = location.pathname.replace(/\/$/, '') || '/';
  const links = navItems(user)
    .map(([label, href]) =>
      `<a href="${href}" class="${here === href ? 'active' : ''}">${escapeHtml(label)}</a>`)
    .join('');

  const right = user
    ? `<a href="/profile" class="pill"><span>${escapeHtml(user.firstName)}</span>
         <span class="orb" aria-hidden="true">${ICON.chevronRight}</span></a>
       <button class="btn btn-ghost btn-sm" id="logout-btn">${escapeHtml(d.signOut)}</button>`
    : `<a href="/login" class="btn btn-ghost btn-sm">${escapeHtml(d.signIn)}</a>
       <a href="/classifier" class="pill"><span>${escapeHtml(d.start)}</span>
         <span class="orb" aria-hidden="true">${ICON.chevronRight}</span></a>`;

  const header = document.getElementById('site-header');
  if (!header) return;
  header.innerHTML = `
    <a href="/" class="wordmark">DEPTIFY</a>
    <nav class="nav-links" aria-label="Primary">${links}</nav>
    <div class="hdr-right">
      <div class="lang-wrap">
        <button class="icon-btn lang-btn" id="lang-btn" aria-haspopup="listbox"
                aria-expanded="false" aria-label="Change language"><span id="lang-code">${lang.toUpperCase()}</span></button>
        <div class="lang-menu" id="lang-menu" role="listbox" aria-label="Language selection">
          <button role="option" data-lang="az"><span>Azərbaycan</span><span class="code">AZ</span></button>
          <button role="option" data-lang="en"><span>English</span><span class="code">EN</span></button>
          <button role="option" data-lang="ru"><span>Русский</span><span class="code">RU</span></button>
        </div>
      </div>
      <button class="icon-btn nav-toggle" id="nav-toggle" aria-expanded="false"
              aria-controls="mobile-nav" aria-label="Open menu">${ICON.menu}</button>
      ${right}
    </div>`;

  // Mobile drawer
  let drawer = document.getElementById('mobile-nav');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'mobile-nav';
    document.body.append(drawer);
  }
  drawer.innerHTML = navItems(user)
    .map(([label, href]) => `<a href="${href}">${escapeHtml(label)}</a>`).join('');

  const toggle = document.getElementById('nav-toggle');
  toggle?.addEventListener('click', () => {
    const open = drawer.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.innerHTML = open ? ICON.close : ICON.menu;
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });

  document.getElementById('logout-btn')?.addEventListener('click', logout);
  wireLangMenu(user);
}

function wireLangMenu(user) {
  const btn = document.getElementById('lang-btn');
  const menu = document.getElementById('lang-menu');
  if (!btn || !menu) return;

  menu.querySelectorAll('[data-lang]').forEach((b) => {
    const on = b.dataset.lang === lang;
    b.classList.toggle('sel', on);
    b.setAttribute('aria-selected', String(on));
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', (e) => {
    const option = e.target.closest('[data-lang]');
    if (!option) return;
    lang = option.dataset.lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ }
    document.documentElement.lang = lang;
    renderHeader(user);
    renderFooter();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.lang-wrap')) {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

function renderFooter() {
  const footer = document.getElementById('site-footer');
  if (!footer) return;
  const d = t();
  footer.innerHTML = `
    <div class="bloom bloom-a" aria-hidden="true"></div>
    <div class="bloom bloom-b" aria-hidden="true"></div>
    <div class="footer-body">
      <div class="footer-grid">
        <div>
          <div class="f-label">${escapeHtml(d.footerLabel)}</div>
          <h2 class="f-head">${d.footerHead}</h2>
          <a class="mail-pill" href="/classifier">
            <span>${escapeHtml(d.footerCta)}</span>
            <span class="mail-orb" aria-hidden="true">${ICON.arrowUpRight}</span>
          </a>
        </div>
        <div>
          <div class="link-cols">
            ${d.cols.map((col) => `
              <div class="link-col">
                <h3>${escapeHtml(col.title)}</h3>
                <ul>${col.links.map(([label, href]) =>
                  `<li><a href="${href}">${escapeHtml(label)}</a></li>`).join('')}</ul>
              </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <div class="fb-left">
          <span class="fb-mark">DEPTIFY</span>
          <span class="fb-dot" aria-hidden="true"></span>
          <span class="fb-copy">${escapeHtml(d.copy)}</span>
        </div>
      </div>
    </div>`;
}

/**
 * Call once per page. Returns the signed-in user (or null) so pages can branch
 * without a second round-trip.
 */
export async function mountShell() {
  document.documentElement.lang = lang;
  if (!document.getElementById('bg-gradient')) {
    const bg = document.createElement('div');
    bg.id = 'bg-gradient';
    document.body.prepend(bg);
  }
  const user = await currentUser();
  renderHeader(user);
  renderFooter();
  observeReveals();
  return user;
}

export { readLang };
