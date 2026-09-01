document.documentElement.classList.add('js');

const HOMEPAGE_LOADER_KEY = 'intersacks-loader-shown';

const isHomepage = () => {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' || path === '/' || /\/index\.html?$/i.test(path);
};

const revealPage = (loader) => {
  const root = document.documentElement;
  root.classList.add('page-ready');
  if (!loader) {
    return;
  }

  if (loader.classList.contains('is-hidden')) return;
  loader.classList.add('is-hidden');
  loader.setAttribute('aria-hidden', 'true');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const removeDelay = reduceMotion ? 0 : 450;
  window.setTimeout(() => {
    loader.hidden = true;
    loader.remove();
  }, removeDelay);
};

document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const loader = document.getElementById('site-loader');

  if (loader && isHomepage()) {
    let shouldShowLoader = true;
    try {
      shouldShowLoader = !(window.sessionStorage && window.sessionStorage.getItem(HOMEPAGE_LOADER_KEY) === 'true');
    } catch (error) {
      shouldShowLoader = true;
    }

    if (!shouldShowLoader) {
      loader.hidden = true;
      loader.remove();
      root.classList.add('page-ready');
    } else {
      try {
        window.sessionStorage.setItem(HOMEPAGE_LOADER_KEY, 'true');
      } catch (error) {
        // A blocked sessionStorage should not break the homepage.
      }

      const dismissLoader = () => revealPage(loader);
      const safetyTimeout = window.setTimeout(dismissLoader, 2500);
      const delay = reduceMotion ? 0 : 1800;
      window.setTimeout(() => {
        window.clearTimeout(safetyTimeout);
        dismissLoader();
      }, delay);
    }
  } else {
    root.classList.add('page-ready');
  }

  // Keep the compact mobile navigation accessible and predictable.
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.querySelector('.mobile-nav');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
      menu.classList.toggle('open', !open);
    });
    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      menu.classList.remove('open');
    }));
  }

  // Reveal sections once as they enter the viewport.
  const revealElements = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.12 });
    revealElements.forEach((element) => observer.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add('visible'));
  }

  // Static-site form handoff: create a ready-to-send email without a backend.
  const contactForm = document.querySelector('#contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(contactForm);
      const subject = `New ${data.get('service')} enquiry from ${data.get('name')}`;
      const body = [
        `Name: ${data.get('name')}`,
        `Email: ${data.get('email')}`,
        `Business: ${data.get('business') || 'Not provided'}`,
        `Phone: ${data.get('phone') || 'Not provided'}`,
        `Service: ${data.get('service')}`,
        '',
        'Project details:',
        data.get('message')
      ].join('\n');
      window.location.href = `mailto:lesleysacks1@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }

  const year = document.querySelector('#year');
  if (year) year.textContent = new Date().getFullYear();

  // Fade only between the site's primary HTML pages. Excluded link types retain
  // their native browser behaviour, including downloads and new-tab links.
  const internalPages = new Set([
    'index.html', 'about.html', 'services.html', 'work.html',
    'resources.html', 'process.html', 'contact.html'
  ]);

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const href = (link.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#') || link.hasAttribute('download')) return;
    if (link.target && link.target.toLowerCase() !== '_self') return;
    if (/^(mailto:|tel:)/i.test(href)) return;

    let destination;
    try { destination = new URL(link.href, window.location.href); } catch { return; }
    if (!['http:', 'https:'].includes(destination.protocol) || destination.origin !== window.location.origin) return;
    if (/^(wa\.me|(?:www\.)?whatsapp\.com|api\.whatsapp\.com)$/i.test(destination.hostname)) return;

    const pageName = destination.pathname.split('/').pop() || 'index.html';
    if (!internalPages.has(pageName)) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
    if (reduceMotion) return;

    event.preventDefault();
    root.classList.add('page-leaving');
    root.classList.remove('page-ready');
    window.setTimeout(() => window.location.assign(destination.href), 180);
  });

  // A page restored from the back/forward cache should be usable immediately.
  window.addEventListener('pageshow', () => {
    root.classList.remove('page-leaving');
    root.classList.add('page-ready');
  });
});
