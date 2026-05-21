document.addEventListener('DOMContentLoaded', function () {
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

    // Close menu when clicking a link
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

    question.addEventListener('click', function () {
      const isOpen = item.classList.contains('open');

      // Close all others
      faqItems.forEach(function (otherItem) {
        if (otherItem !== item) {
          otherItem.classList.remove('open');
          otherItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
        }
      });

      // Toggle current
      item.classList.toggle('open', !isOpen);
      question.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  // ===== SMOOTH SCROLL FOR ANCHOR LINKS =====
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const navHeight = document.querySelector('.nav').offsetHeight;
        const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;
        window.scrollTo({ top: targetPosition, behavior: 'smooth' });
      }
    });
  });

  // ===== NAV BACKGROUND ON SCROLL =====
  const nav = document.querySelector('.nav');
  let lastScroll = 0;

  window.addEventListener('scroll', function () {
    const currentScroll = window.pageYOffset;
    if (currentScroll > 50) {
      nav.style.boxShadow = '0 1px 12px rgba(0,0,0,0.06)';
    } else {
      nav.style.boxShadow = 'none';
    }
    lastScroll = currentScroll;
  });

  // ===== LEAD CAPTURE FORM =====
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
      errorDiv.style.display = 'none';

      try {
        const response = await fetch('https://ytt-leads.sebastian-brosche.workers.dev/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, source: 'ytt-website' })
        });

        const data = await response.json();

        if (response.ok) {
          applyForm.style.display = 'none';
          thanksDiv.style.display = 'block';
          gtag && gtag('event', 'generate_lead', { method: 'email' });
        } else {
          throw new Error(data.error || 'Something went wrong');
        }
      } catch (err) {
        errorDiv.querySelector('p').textContent = err.message;
        errorDiv.style.display = 'block';
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }
});
