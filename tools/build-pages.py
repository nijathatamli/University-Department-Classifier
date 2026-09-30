#!/usr/bin/env python3
"""
Generates the static HTML shells for every application page.

Every page shares one <head> and the same header/footer mount points, which is
what keeps the whole product on the landing page's design system. Page bodies
are authored here; behaviour lives in web/assets/<script>.js.

Run:  python3 tools/build-pages.py
"""
import pathlib

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"

HEAD = """<!doctype html>
<html lang="az">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>{title} · DEPTIFY</title>
<meta name="description" content="{desc}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@300;400;500;600;700&family=Raleway:wght@400;500;600;700;900&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/design-system.css" />
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div id="bg-gradient"></div>
<header id="site-header"></header>
<main id="main" class="page{page_class}">
{content}
</main>
<footer id="site-footer"></footer>
<script type="module" src="/assets/{script}"></script>
</body>
</html>
"""


def page(name, title, desc, content, script, page_class=""):
    (WEB / f"{name}.html").write_text(
        HEAD.format(title=title, desc=desc, content=content, script=script,
                    page_class=page_class),
        encoding="utf-8",
    )
    print(f"  wrote {name}.html")


def head_block(label, heading, body):
    return f"""  <section class="page-head reveal">
    <div class="label-mono">{label}</div>
    <h1 class="h-page">{heading}</h1>
    <p class="body-p">{body}</p>
  </section>"""


# ---------------------------------------------------------------------------
# Classifier — the core page
# ---------------------------------------------------------------------------

page("classifier", "Müraciət göndər",
     "Write your request and have it routed automatically to the right department.",
     head_block("[ Müraciət ]", "Müraciətinizi yazın,<br>biz yönləndirək.",
                "Şikayət, sorğu və ya təklifinizi öz sözlərinizlə yazın. Model mətni təhlil edir, "
                "məsul şöbəni müəyyən edir və müraciətinizi avtomatik olaraq həmin şöbəyə göndərir.") + """
  <section class="panel reveal">
    <form id="classify-form" novalidate>
      <div class="field">
        <label for="message">Müraciətiniz</label>
        <textarea class="textarea" id="message" name="message" rows="7"
                  placeholder="Şikayət, sorğu və ya təklifinizi buraya yazın..."
                  aria-describedby="message-hint"></textarea>
        <span class="field-error"></span>
        <span class="field-hint" id="message-hint">
          Ən azı 10 simvol. <span id="char-count">0</span>/4000
        </span>
      </div>

      <div class="row-between mt-6">
        <span class="meta" id="classifier-state"></span>
        <button class="btn btn-primary" type="submit" id="submit-btn">Müraciəti göndər</button>
      </div>
    </form>
  </section>

  <section id="result" class="mt-8" aria-live="polite"></section>

  <section class="panel mt-8 reveal">
    <div class="label-mono">[ Nümunələr ]</div>
    <p class="body-p mt-4" style="font-size:15px">Sınamaq üçün bunlardan birinə toxunun:</p>
    <div class="chips mt-6" id="examples"></div>
  </section>""",
     "classifier.js")

# ---------------------------------------------------------------------------
# Student history
# ---------------------------------------------------------------------------

page("requests", "Müraciətlərim",
     "Your submitted requests, the department each was routed to, and its status.",
     head_block("[ Müraciətlərim ]", "Göndərdiyiniz<br>müraciətlər.",
                "Hər müraciətin hansı şöbəyə yönləndirildiyini, modelin etibarlılıq faizini və "
                "cari statusunu burada izləyə bilərsiniz.") + """
  <section class="row mt-6" id="filters">
    <button class="btn btn-ghost btn-sm" data-status="" aria-pressed="true">Hamısı</button>
    <button class="btn btn-ghost btn-sm" data-status="NEW" aria-pressed="false">Yeni</button>
    <button class="btn btn-ghost btn-sm" data-status="IN_REVIEW" aria-pressed="false">Baxılır</button>
    <button class="btn btn-ghost btn-sm" data-status="RESOLVED" aria-pressed="false">Həll edilib</button>
    <a class="btn btn-primary btn-sm" href="/classifier" style="margin-left:auto">Yeni müraciət</a>
  </section>

  <section id="list" class="mt-8"></section>
  <nav id="pagination" class="pagination" aria-label="Pagination"></nav>""",
     "requests.js")

# ---------------------------------------------------------------------------
# Account profile
# ---------------------------------------------------------------------------

page("profile", "Profil", "Manage your account and personal information.",
     """  <div id="profile-root"></div>""", "profile.js")

# ---------------------------------------------------------------------------
# Department queue
# ---------------------------------------------------------------------------

page("department", "Şöbə paneli",
     "Department queue: requests routed here, with status controls.",
     """  <div id="department-root"></div>""", "department.js")

# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

page("admin", "Admin", "Administration, routing statistics and model metrics.",
     """  <div id="admin-root"></div>""", "admin.js")

# ---------------------------------------------------------------------------
# Static pages
# ---------------------------------------------------------------------------

page("how-it-works", "Necə işləyir",
     "How the request router classifies and assigns student messages.",
     head_block("[ Necə işləyir ]", "Mətndən<br>şöbəyə.",
                "Sistem yazdığınız mətni təhlil edir və onu dörd şöbədən birinə yönləndirir. "
                "Aşağıda hər addımın nə etdiyi izah olunur.") + """
  <section class="stack-lg mt-8">
    <article class="card card-hover reveal">
      <div class="card-in">
        <div class="card-head"><span class="card-idx">01</span>
          <span class="card-key">Mətn</span><span class="dot-blue"></span></div>
        <h2 class="h-card">Siz müraciətinizi yazırsınız</h2>
        <p class="card-desc">Heç bir forma, kateqoriya və ya açılan siyahı seçmirsiniz.
          Sadəcə problemi öz sözlərinizlə yazırsınız — necə danışırsınızsa, elə də.</p>
      </div>
    </article>

    <article class="card card-hover reveal" data-delay="0.05">
      <div class="card-in">
        <div class="card-head"><span class="card-idx">02</span>
          <span class="card-key">Təmizləmə</span><span class="dot-blue"></span></div>
        <h2 class="h-card">Mətn normallaşdırılır</h2>
        <p class="card-desc">Böyük-kiçik hərflər, durğu işarələri və rəqəmlər təmizlənir.
          Azərbaycan dilindəki nöqtəli/nöqtəsiz <em>i</em> problemi ayrıca həll olunur ki,
          «İT» və «it» eyni token kimi görünsün.</p>
      </div>
    </article>

    <article class="card card-hover reveal" data-delay="0.1">
      <div class="card-in">
        <div class="card-head"><span class="card-idx">03</span>
          <span class="card-key">TF-IDF</span><span class="dot-blue"></span></div>
        <h2 class="h-card">Mətn rəqəmlərə çevrilir</h2>
        <p class="card-desc">Söz deyil, <strong>hərf n-qramları</strong> istifadə olunur
          (char_wb, 2–5). Azərbaycan dili aqlütinativdir — «kitab», «kitabı», «kitabxanadan»
          fərqli sözlərdir, amma eyni kökü daşıyır. Ölçdüyümüz fərq böyükdür:
          söz əsaslı yanaşmada dəqiqlik 0.56, hərf əsaslı yanaşmada 0.80.</p>
      </div>
    </article>

    <article class="card card-hover reveal" data-delay="0.15">
      <div class="card-in">
        <div class="card-head"><span class="card-idx">04</span>
          <span class="card-key">Model</span><span class="dot-blue"></span></div>
        <h2 class="h-card">Logistic Regression təsnifat aparır</h2>
        <p class="card-desc">Öyrədilmiş model hər şöbə üçün ehtimal qaytarır. Ekranda gördüyünüz
          faiz birbaşa modelin çıxışıdır — əl ilə yazılmış rəqəm deyil.</p>
      </div>
    </article>

    <article class="card card-hover reveal" data-delay="0.2">
      <div class="card-in">
        <div class="card-head"><span class="card-idx">05</span>
          <span class="card-key">Yönləndirmə</span><span class="dot-blue"></span></div>
        <h2 class="h-card">Müraciət avtomatik göndərilir</h2>
        <p class="card-desc">Ən yüksək ehtimallı şöbə seçilir, müraciətiniz üçün bilet yaradılır
          və həmin şöbənin növbəsinə düşür. Şöbə əməkdaşı statusu dəyişdikdə siz də görürsünüz.</p>
      </div>
    </article>
  </section>

  <section class="panel mt-10 reveal">
    <div class="label-mono">[ Modelin hazırkı göstəriciləri ]</div>
    <div id="live-metrics" class="mt-6"></div>
  </section>

  <section class="panel mt-8 reveal">
    <div class="label-mono">[ Məhdudiyyətlər ]</div>
    <p class="body-p mt-4">Model 151 cümləlik kiçik datasetlə öyrədilib və hər beş müraciətdən
      təxminən birini səhv şöbəyə yönləndirə bilər. Etibarlılıq faizi aşağı olan müraciətlər
      admin panelində ayrıca göstərilir ki, insan nəzarəti mümkün olsun. Şöbə əməkdaşı səhv
      yönləndirilmiş müraciəti görsə, statusu dəyişə bilər.</p>
  </section>""",
     "how-it-works.js")

page("about", "Haqqımızda", "About the student request routing system.",
     head_block("[ Haqqımızda ]", "Müraciətlər<br>itmir.",
                "DEPTIFY tələbə müraciətlərini oxuyur və avtomatik olaraq məsul şöbəyə yönləndirir.") + """
  <section class="stack-lg mt-8">
    <div class="panel reveal">
      <h2 class="h-section">Problem</h2>
      <p class="body-p mt-4">Tələbə problemi ilə üzləşəndə çox vaxt kimə müraciət edəcəyini bilmir.
        Maliyyə məsələsini dekanata yazır, texniki problemi kitabxanaya. Müraciət şöbədən şöbəyə
        ötürülür, cavab gecikir, bəzən ümumiyyətlə itir.</p>
    </div>

    <div class="panel reveal" data-delay="0.05">
      <h2 class="h-section">Həll</h2>
      <p class="body-p mt-4">Tələbə sadəcə yazır. NLP modeli mətni təhlil edir və müraciəti dörd
        şöbədən birinə — Dekanat, Maliyyə, Kitabxana və ya İT Dəstək — yönləndirir. Müraciət
        dərhal həmin şöbənin növbəsinə düşür və tələbə statusu izləyə bilir.</p>
    </div>

    <div class="panel reveal" data-delay="0.1">
      <h2 class="h-section">Texnologiya</h2>
      <p class="body-p mt-4">TF-IDF vektorizasiya və Logistic Regression — Python və scikit-learn
        üzərində. Model Azərbaycan dilində hazırlanmış 151 cümləlik datasetlə öyrədilib.
        Veb tətbiq Node.js və PostgreSQL üzərində işləyir; model ayrıca xidmət kimi saxlanılır və
        hər sorğuda yenidən öyrədilmir.</p>
    </div>

    <div class="panel reveal" data-delay="0.15">
      <h2 class="h-section">Məlumatlarınız</h2>
      <p class="body-p mt-4">Müraciətiniz yalnız sizin hesabınıza bağlıdır. Onu siz, yönləndirildiyi
        şöbənin əməkdaşı və administrator görə bilər — başqa tələbə və ya başqa şöbə yox. Bu qayda
        brauzerdə deyil, serverdə yoxlanılır. Şifrələr Argon2id ilə hash olunur.</p>
      <div class="row mt-6">
        <a class="btn btn-primary" href="/classifier">Müraciət göndər</a>
        <a class="btn btn-ghost" href="/how-it-works">Necə işləyir</a>
      </div>
    </div>
  </section>""",
     "how-it-works.js")

page("contact", "Əlaqə", "Get in touch with the DEPTIFY team.",
     head_block("[ Əlaqə ]", "Bizimlə əlaqə.",
                "Sistemlə bağlı sualınız, səhv yönləndirmə və ya təklifiniz varsa, yazın.") + """
  <section class="panel reveal" style="max-width:640px">
    <form id="contact-form" novalidate>
      <div class="stack">
        <div class="field">
          <label for="name">Adınız</label>
          <input class="input" id="name" name="name" autocomplete="name" required />
          <span class="field-error"></span>
        </div>
        <div class="field">
          <label for="email">E-poçt</label>
          <input class="input" id="email" name="email" type="email" autocomplete="email" required />
          <span class="field-error"></span>
        </div>
        <div class="field">
          <label for="subject">Mövzu</label>
          <input class="input" id="subject" name="subject" required />
          <span class="field-error"></span>
        </div>
        <div class="field">
          <label for="message">Mesaj</label>
          <textarea class="textarea" id="message" name="message" required
                    placeholder="Nə barədə yazmaq istəyirsiniz?"></textarea>
          <span class="field-error"></span>
          <span class="field-hint">Ən azı 10 simvol.</span>
        </div>
        <button class="btn btn-primary" type="submit" id="submit-btn">Göndər</button>
      </div>
    </form>
    <div id="contact-success" hidden></div>
  </section>""",
     "contact.js")

# ---------------------------------------------------------------------------
# Auth pages
# ---------------------------------------------------------------------------

def auth_page(name, title, label, heading, blurb, form, script):
    page(name, title, blurb, f"""  <section class="panel reveal" style="width:min(460px,100%)">
    <div class="label-mono">{label}</div>
    <h1 class="h-section mt-4">{heading}</h1>
    <p class="body-p mt-4" style="font-size:15px">{blurb}</p>
    {form}
  </section>""", script, page_class=" page--auth")


auth_page("login", "Daxil ol", "[ Daxil ol ]", "Xoş gəlmisiniz.",
          "Müraciətlərinizi göndərmək və izləmək üçün hesabınıza daxil olun.", """
    <form id="auth-form" class="stack mt-8" novalidate>
      <div class="field">
        <label for="email">E-poçt</label>
        <input class="input" id="email" name="email" type="email" autocomplete="email" required />
        <span class="field-error"></span>
      </div>
      <div class="field">
        <label for="password">Şifrə</label>
        <input class="input" id="password" name="password" type="password"
               autocomplete="current-password" required />
        <span class="field-error"></span>
      </div>
      <div id="form-error" class="field-error" role="alert"></div>
      <button class="btn btn-primary btn-block" type="submit" id="submit-btn">Daxil ol</button>
      <div class="row-between mt-4">
        <a class="body-p" style="font-size:14px" href="/forgot-password">Şifrəni unutmusunuz?</a>
        <a class="body-p" style="font-size:14px" href="/register">Hesab yaradın</a>
      </div>
    </form>""", "login.js")

auth_page("register", "Qeydiyyat", "[ Qeydiyyat ]", "Hesab yaradın.",
          "Müraciət göndərmək və cavabları izləmək üçün qeydiyyatdan keçin.", """
    <form id="auth-form" class="stack mt-8" novalidate>
      <div class="grid grid-2" style="gap:12px">
        <div class="field">
          <label for="firstName">Ad</label>
          <input class="input" id="firstName" name="firstName" autocomplete="given-name" required />
          <span class="field-error"></span>
        </div>
        <div class="field">
          <label for="lastName">Soyad</label>
          <input class="input" id="lastName" name="lastName" autocomplete="family-name" required />
          <span class="field-error"></span>
        </div>
      </div>
      <div class="field">
        <label for="email">E-poçt</label>
        <input class="input" id="email" name="email" type="email" autocomplete="email" required />
        <span class="field-error"></span>
      </div>
      <div class="field">
        <label for="password">Şifrə</label>
        <input class="input" id="password" name="password" type="password"
               autocomplete="new-password" required />
        <span class="field-error"></span>
        <span class="field-hint">Ən azı 8 simvol, böyük və kiçik hərf, rəqəm.</span>
      </div>
      <div id="form-error" class="field-error" role="alert"></div>
      <button class="btn btn-primary btn-block" type="submit" id="submit-btn">Hesab yarat</button>
      <p class="body-p mt-4" style="font-size:14px">Hesabınız var?
        <a href="/login" style="text-decoration:underline">Daxil olun</a></p>
    </form>""", "register.js")

auth_page("forgot-password", "Şifrə bərpası", "[ Şifrə bərpası ]", "Şifrənizi unutmusunuz?",
          "E-poçt ünvanınızı yazın, bərpa linki göndərək.", """
    <form id="auth-form" class="stack mt-8" novalidate>
      <div class="field">
        <label for="email">E-poçt</label>
        <input class="input" id="email" name="email" type="email" autocomplete="email" required />
        <span class="field-error"></span>
      </div>
      <div id="form-error" class="field-error" role="alert"></div>
      <button class="btn btn-primary btn-block" type="submit" id="submit-btn">Bərpa linki göndər</button>
      <div id="reset-sent" class="mt-4" hidden></div>
      <a class="body-p mt-4" style="font-size:14px" href="/login">Girişə qayıt</a>
    </form>""", "forgot-password.js")

auth_page("reset-password", "Yeni şifrə", "[ Şifrə bərpası ]", "Yeni şifrə təyin edin.",
          "Hesabınız üçün yeni şifrə seçin.", """
    <form id="auth-form" class="stack mt-8" novalidate>
      <div class="field">
        <label for="token">Bərpa kodu</label>
        <input class="input" id="token" name="token" required />
        <span class="field-error"></span>
        <span class="field-hint">Linkdə varsa avtomatik doldurulur.</span>
      </div>
      <div class="field">
        <label for="password">Yeni şifrə</label>
        <input class="input" id="password" name="password" type="password"
               autocomplete="new-password" required />
        <span class="field-error"></span>
      </div>
      <div id="form-error" class="field-error" role="alert"></div>
      <button class="btn btn-primary btn-block" type="submit" id="submit-btn">Şifrəni yenilə</button>
    </form>""", "reset-password.js")

print("done")
