(function () {
  var MEASUREMENT_ID = 'G-XCN1MN0GHR';
  var PRODUCTION_HOSTS = {
    'www.intersacks.co.za': true,
    'intersacks.co.za': true
  };
  var SERVICE_NAMES = {
    'web-solutions': 'Web Solutions',
    branding: 'Branding',
    'business-automation': 'Business Automation',
    'ai-software': 'AI and Software'
  };

  if (window.__intersacksAnalytics) return;
  window.__intersacksAnalytics = true;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
  }

  var production = PRODUCTION_HOSTS[window.location.hostname] === true;
  if (production && !document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) {
    var loader = document.createElement('script');
    loader.async = true;
    loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
    document.head.appendChild(loader);
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID);
  }

  var seenServices = Object.create(null);

  function pagePath() {
    return window.location.pathname || '/';
  }

  function serviceSection(element) {
    if (!element || !element.closest) return null;
    return element.closest('#web-solutions, #branding, #business-automation, #ai-software');
  }

  function serviceName(element) {
    var section = element && element.id && SERVICE_NAMES[element.id] ? element : serviceSection(element);
    return section ? SERVICE_NAMES[section.id] || '' : '';
  }

  function linkLocation(link) {
    if (link.classList.contains('whatsapp-button')) return 'floating';
    if (link.closest('.mobile-nav')) return 'mobile-nav';
    if (link.closest('header')) return 'header';
    if (link.closest('footer')) return 'footer';
    if (link.closest('.hero, .page-hero')) return 'hero';
    if (serviceSection(link)) return 'service';
    if (link.closest('.contact, .contact-page, .contact-details')) return 'contact';
    return 'page';
  }

  function track(name, params) {
    var payload = { page_path: pagePath() };
    if (params) {
      ['service_name', 'link_location'].forEach(function (key) {
        if (params[key]) payload[key] = String(params[key]).slice(0, 80);
      });
    }
    payload.transport_type = 'beacon';
    window.gtag('event', name, payload);
  }

  function classify(link) {
    var href = link.getAttribute('href') || '';
    if (/^mailto:/i.test(href)) return 'email_click';
    if (/^tel:/i.test(href)) return 'phone_click';
    var host = '';
    try {
      host = new URL(link.href, window.location.href).hostname;
    } catch (error) {
      host = '';
    }
    if (/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/i.test(host) || /(^|\.)api\.whatsapp\.com$/i.test(host)) return 'whatsapp_click';
    var label = (link.getAttribute('aria-label') || link.textContent || '').replace(/\s+/g, ' ');
    if (/request a quote|quote request/i.test(label)) return 'quote_request_click';
    return '';
  }

  document.addEventListener('click', function (event) {
    if (event.button !== 0) return;
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var name = classify(link);
    if (!name) return;
    var params = { link_location: linkLocation(link) };
    var service = serviceName(link);
    if (service) params.service_name = service;
    track(name, params);
  });

  function observeServices() {
    var sections = document.querySelectorAll('#web-solutions, #branding, #business-automation, #ai-software');
    if (!sections.length) return;
    var emit = function (section) {
      if (seenServices[section.id]) return;
      seenServices[section.id] = true;
      track('service_view', { service_name: serviceName(section), link_location: 'service' });
    };
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(sections, emit);
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var section = entry.target.closest ? entry.target.closest('#web-solutions, #branding, #business-automation, #ai-software') : entry.target;
        emit(section);
      });
    }, { threshold: 0.5 });
    Array.prototype.forEach.call(sections, function (section) {
      observer.observe(section.querySelector('h2') || section);
    });
  }

  function contactView() {
    var path = pagePath();
    if (/\/contact\.html$/.test(path) || path === '/contact') {
      track('contact_page_view', { link_location: 'contact' });
    }
  }

  function start() {
    observeServices();
    contactView();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
