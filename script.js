document.addEventListener('DOMContentLoaded', function () {
  const LEADS_API = 'https://ytt-leads.sebastian-brosche.workers.dev';

  // ===== MOBILE MENU =====
  const menuBtn = document.querySelector('.mobile-menu-btn');
  const navLinks = document.querySelector('.nav-links');

  if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', function () {
      navLinks.classList.toggle('active');
      const spans = menuBtn.querySelectorAll('span');
      if (navLinks.classList.contains('active')) {
        spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
      } else {
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
      }
    });

    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('active');
        const spans = menuBtn.querySelectorAll('span');
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
      });
    });
  }

  // ===== FAQ ACCORDION =====
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(function (item) {
    const question = item.querySelector('.faq-question');
    if (!question) return;
    question.addEventListener('click', function () {
      const isOpen = item.classList.contains('open');
      faqItems.forEach(function (otherItem) {
        if (otherItem !== item) {
          otherItem.classList.remove('open');
          const q = otherItem.querySelector('.faq-question');
          if (q) q.setAttribute('aria-expanded', 'false');
        }
      });
      item.classList.toggle('open', !isOpen);
      question.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  // ===== SMOOTH SCROLL =====
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const nav = document.querySelector('.nav');
        const navHeight = nav ? nav.offsetHeight : 0;
        const targetPosition =
          target.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;
        window.scrollTo({ top: targetPosition, behavior: 'smooth' });
      }
    });
  });

  // ===== NAV SHADOW =====
  const nav = document.querySelector('.nav');
  if (nav) {
    window.addEventListener('scroll', function () {
      nav.style.boxShadow =
        window.pageYOffset > 50 ? '0 1px 12px rgba(0,0,0,0.06)' : 'none';
    });
  }

  // ===== PRICING (early bird ends 2026-07-15 Lisbon; worker is source of truth) =====
  function applyPricing(p) {
    const price = p.price || 490;
    const early = !p.earlyBirdEnded;
    const label = early
      ? 'One spot left · Early bird €' + price
      : 'One spot left · €' + price;
    const line = early
      ? 'Early bird €' + price + ' · €550 from 15 July'
      : '€' + price + ' · regular rate';

    document.querySelectorAll('[data-price-display]').forEach(function (el) {
      el.textContent = '€' + price;
    });
    document.querySelectorAll('[data-price-line]').forEach(function (el) {
      el.textContent = line;
    });
    document.querySelectorAll('[data-pay-cta]').forEach(function (el) {
      el.textContent = early
        ? 'Pay Now - €' + price + ' · last spot'
        : 'Pay Now - €' + price + ' · last spot';
      if (p.payUrl) el.setAttribute('href', p.payUrl);
    });

    const pricingLabel = document.getElementById('pricingLabel');
    const pricingNote = document.getElementById('pricingNote');
    const pricingFootnote = document.getElementById('pricingFootnote');
    if (pricingLabel) pricingLabel.textContent = label;
    if (pricingNote) {
      pricingNote.textContent = early
        ? 'Register before 15 July 2026 · then €550'
        : 'Regular price · one spot left';
    }
    if (pricingFootnote) {
      pricingFootnote.textContent = early
        ? 'Price flips automatically at midnight Lisbon on 15 July 2026.'
        : 'Early bird has ended. Price is €550.';
    }
    const heroPriceLine = document.getElementById('heroPriceLine');
    if (heroPriceLine && early === false) {
      heroPriceLine.innerHTML =
        '<strong>€' + price + '</strong> · <strong>one spot left</strong>';
    }
  }

  // Local fallback until /api/pricing responds
  (function localPricingFallback() {
    try {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Lisbon',
      }).format(new Date());
      applyPricing({
        earlyBirdEnded: today >= '2026-07-15',
        price: today >= '2026-07-15' ? 550 : 490,
        payUrl:
          'https://backoffice.bsport.io/customer/payment/shop-item/460282/?membership=5821',
      });
    } catch (e) {}
  })();

  fetch(LEADS_API + '/api/pricing')
    .then(function (r) {
      return r.json();
    })
    .then(applyPricing)
    .catch(function () {});

  // ===== LEAD CAPTURE (SCULPT interest) =====
  const applyForm = document.getElementById('applyForm');
  const thanksDiv = document.getElementById('thanks');
  const errorDiv = document.getElementById('formError');

  if (applyForm) {
    applyForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = document.getElementById('applicantEmail').value.trim();
      const btn = applyForm.querySelector('button[type="submit"]');
      const originalText = btn.textContent;

      btn.disabled = true;
      btn.textContent = 'Sending...';
      if (errorDiv) errorDiv.style.display = 'none';

      try {
        const response = await fetch(LEADS_API + '/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            source: 'sculpt-website',
            programme: 'sculpt-sept-2026',
          }),
        });
        const data = await response.json();
        if (response.ok) {
          applyForm.style.display = 'none';
          if (thanksDiv) thanksDiv.style.display = 'block';
          typeof gtag === 'function' &&
            gtag('event', 'generate_lead', { method: 'email', programme: 'sculpt' });
        } else {
          throw new Error(data.error || 'Something went wrong');
        }
      } catch (err) {
        if (errorDiv) {
          const p = errorDiv.querySelector('p');
          if (p) p.textContent = err.message;
          errorDiv.style.display = 'block';
        }
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }

  // ===== 2027 WAITLIST =====
  const waitlistForm = document.getElementById('waitlistForm');
  if (waitlistForm) {
    waitlistForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const emailEl = document.getElementById('waitlistEmail');
      const nameEl = document.getElementById('waitlistName');
      const thanks = document.getElementById('waitlistThanks');
      const errBox = document.getElementById('waitlistError');
      const email = emailEl ? emailEl.value.trim() : '';
      const name = nameEl ? nameEl.value.trim() : '';
      const btn = waitlistForm.querySelector('button[type="submit"]');
      const originalText = btn.textContent;

      btn.disabled = true;
      btn.textContent = 'Joining...';
      if (errBox) errBox.style.display = 'none';

      try {
        const response = await fetch(LEADS_API + '/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            name: name,
            source: 'waitlist-2027-website',
            programme: 'teacher-training-2027',
            interest: 'waitlist-2027',
          }),
        });
        const data = await response.json();
        if (response.ok) {
          waitlistForm.style.display = 'none';
          if (thanks) thanks.style.display = 'block';
          typeof gtag === 'function' &&
            gtag('event', 'generate_lead', {
              method: 'email',
              programme: 'waitlist-2027',
            });
        } else {
          throw new Error(data.error || 'Something went wrong');
        }
      } catch (err) {
        if (errBox) {
          const p = errBox.querySelector('p');
          if (p) p.textContent = err.message;
          errBox.style.display = 'block';
        }
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }
});
