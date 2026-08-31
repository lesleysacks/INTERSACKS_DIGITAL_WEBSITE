document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const loader = document.querySelector('#site-loader');

  // Reveal normal pages immediately. The homepage waits for its branded loader.
  if (loader) {
    const pageElements = [...document.body.children].filter((element) => element !== loader);
    let loaderDismissed = false;

    document.body.setAttribute('aria-busy', 'true');
    pageElements.forEach((element) => { element.inert = true; });

    const dismissLoader = () => {
      if (loaderDismissed) return;
      loaderDismissed = true;
      window.clearTimeout(safetyTimeout);
      document.body.removeAttribute('aria-busy');
      pageElements.forEach((element) => { element.inert = false; });
      root.classList.add('page-ready');
      loader.classList.add('is-hidden');
      loader.setAttribute('aria-hidden', 'true');
      window.setTimeout(() => { loader.hidden = true; }, reduceMotion ? 0 : 500);
    };

    const safetyTimeout = window.setTimeout(dismissLoader, 5000);
    const dismissAfterLoad = () => window.setTimeout(dismissLoader, reduceMotion ? 0 : 300);
    if (document.readyState === 'complete') dismissAfterLoad();
    else window.addEventListener('load', dismissAfterLoad, { once: true });
  } else {
    window.requestAnimationFrame(() => root.classList.add('page-ready'));
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
