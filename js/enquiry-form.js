/**
 * Contact-form controller. Loaded on contact.html before js/script.js.
 *
 * When data-enquiry-endpoint holds a Google Apps Script /exec URL, the form
 * POSTs into a hidden iframe. Apps Script replies with postMessage. Success
 * is shown only after that message includes the enquiry reference.
 *
 * The spreadsheet ID, owner mailbox, and other script properties never appear
 * here. If the endpoint is not configured, the existing mailto hand-off is
 * used so the live site keeps working until the web app is deployed.
 */
(function (root) {
  var FAILURE_MESSAGE = 'We could not send your enquiry. Please try again, or email lesleysacks1@gmail.com or call 084 325 2262.';
  var SENDING_MESSAGE = 'Sending your enquiry.';
  var SAFE_MESSAGE = /^[A-Za-z0-9 ,.'’\-()]{8,200}$/;
  var CHANNEL = 'intersacks-enquiry';
  var RESPONSE_TIMEOUT_MS = 20000;

  function createEnquiryController(options) {
    var form = options.form;
    var status = form.querySelector('#form-status');
    var button = form.querySelector('button[type="submit"]');
    var pagePath = options.pagePath;
    var mailtoFallback = options.mailtoFallback;
    var addWindowListener = options.addWindowListener || function (type, listener) {
      if (root.addEventListener) root.addEventListener(type, listener);
    };
    var now = options.now || function () { return Date.now(); };
    var createKey = options.createKey || defaultKey;
    var submissionKey = '';
    var busy = false;
    var pending = null;

    ensureHiddenFields(form);
    addWindowListener('message', onMessage);

    form.addEventListener('submit', onSubmit);
    form.addEventListener('invalid', function () {
      var problem = clientProblem(readForm(form));
      if (problem) setStatus(problem, true, false);
    }, true);

    function onSubmit(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (busy) return;

      var values = readForm(form);
      var problem = clientProblem(values);
      if (problem) {
        setStatus(problem, true, false);
        if (typeof form.reportValidity === 'function') form.reportValidity();
        return;
      }
      if (typeof form.reportValidity === 'function' && form.reportValidity() === false) {
        return;
      }

      if (!configuredEndpoint()) {
        if (typeof mailtoFallback === 'function') mailtoFallback(form);
        return;
      }

      busy = true;
      setLoading(true);
      setStatus(SENDING_MESSAGE, false, false);

      var key = currentKey();
      writeHidden(form, 'submissionKey', key);
      writeHidden(form, 'page', currentPage());
      writeHidden(form, 'responseFormat', 'html');

      form.setAttribute('method', 'post');
      form.setAttribute('action', configuredEndpoint());
      form.setAttribute('target', 'enquiry-response');
      form.method = 'post';
      form.action = configuredEndpoint();
      form.target = 'enquiry-response';

      pending = {
        key: key,
        startedAt: now(),
        timer: root.setTimeout ? root.setTimeout(onTimeout, RESPONSE_TIMEOUT_MS) : null
      };

      if (typeof form.submit === 'function') form.submit();
    }

    function onMessage(event) {
      if (!pending) return;
      if (!isTrustedEnquiryOrigin(event && event.origin)) return;
      var data = event && event.data;
      if (!data || data.channel !== CHANNEL) return;
      if (data.submissionKey && data.submissionKey !== pending.key) return;
      finishPending();

      if (data.code === 'TEST_MODE') {
        var testMessage = typeof data.message === 'string' ? data.message.trim() : '';
        setStatus(SAFE_MESSAGE.test(testMessage) ? testMessage : 'External submissions are disabled while the script is in test mode.', true, false);
        return;
      }

      if (data.ok === true && typeof data.reference === 'string' && /^ISD-\d{8}-\d+$/.test(data.reference.trim())) {
        var reference = data.reference.trim();
        if (data.customerEmail === 'failed') {
          setStatus('Your enquiry was saved. Your reference is ' + reference + '. We could not send the email acknowledgement. Submit again to retry the email. This is not a confirmed booking.', true, false);
          return;
        }
        if (typeof form.reset === 'function') form.reset();
        submissionKey = '';
        setStatus('Thank you. Your enquiry has been received. Your reference is ' + reference + '. This is not a confirmed booking.', false, true);
        return;
      }

      var forwarded = data && typeof data.message === 'string' ? data.message.trim() : '';
      if (SAFE_MESSAGE.test(forwarded)) {
        setStatus(forwarded, true, false);
        return;
      }
      setStatus(FAILURE_MESSAGE, true, false);
    }

    function onTimeout() {
      if (!pending) return;
      finishPending();
      setStatus(FAILURE_MESSAGE, true, false);
    }

    function finishPending() {
      if (pending && pending.timer && root.clearTimeout) root.clearTimeout(pending.timer);
      pending = null;
      busy = false;
      setLoading(false);
    }

    function currentKey() {
      if (!submissionKey) submissionKey = createKey();
      return submissionKey;
    }

    function currentPage() {
      if (pagePath) return pagePath;
      try {
        var path = root.location && root.location.pathname;
        if (path && path.charAt(0) === '/') return path.split('?')[0].split('#')[0];
      } catch (error) {}
      return '/contact.html';
    }

    function configuredEndpoint() {
      var configured = form.getAttribute('data-enquiry-endpoint');
      if (!configured) return '';
      var url = String(configured).trim();
      if (!url) return '';
      if (/DEPLOYMENT_ID/i.test(url)) return '';
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/i.test(url)) return '';
      return url;
    }

    function setLoading(loading) {
      form.setAttribute('aria-busy', loading ? 'true' : 'false');
      if (!button) return;
      button.disabled = loading;
      if (button.classList && button.classList.toggle) button.classList.toggle('is-loading', loading);
      button.setAttribute('aria-disabled', loading ? 'true' : 'false');
      var label = button.querySelector ? button.querySelector('.send-label') : null;
      if (label) {
        if (!button.getAttribute('data-label')) button.setAttribute('data-label', label.textContent);
        label.textContent = loading ? 'Sending enquiry' : button.getAttribute('data-label');
      }
      var progress = form.querySelector ? form.querySelector('.lead-progress') : null;
      if (progress) {
        if (loading) progress.removeAttribute('hidden');
        else progress.setAttribute('hidden', 'hidden');
      }
    }

    function setStatus(text, isError, isSuccess) {
      if (!status) return;
      status.textContent = text;
      if (status.classList && status.classList.toggle) {
        status.classList.toggle('is-error', isError);
        status.classList.toggle('is-success', isSuccess);
      }
    }

    return {
      onSubmit: onSubmit,
      onMessage: onMessage
    };
  }

  function ensureHiddenFields(form) {
    ['submissionKey', 'page', 'responseFormat'].forEach(function (name) {
      if (form.querySelector('[name="' + name + '"]')) return;
      var input = root.document && root.document.createElement ? root.document.createElement('input') : null;
      if (!input) return;
      input.type = 'hidden';
      input.name = name;
      form.appendChild(input);
    });
  }

  function writeHidden(form, name, value) {
    var field = form.querySelector('[name="' + name + '"]');
    if (field) field.value = value;
  }

  function readForm(form) {
    return {
      name: fieldValue(form, 'name'),
      email: fieldValue(form, 'email'),
      business: fieldValue(form, 'business'),
      phone: fieldValue(form, 'phone'),
      service: fieldValue(form, 'service'),
      message: fieldValue(form, 'message'),
      fax_number: fieldValue(form, 'fax_number')
    };
  }

  function fieldValue(form, name) {
    if (!form.elements || typeof form.elements.namedItem !== 'function') return '';
    var field = form.elements.namedItem(name);
    if (!field) return '';
    if (field.length && field[0] && field[0].type === 'radio') {
      for (var i = 0; i < field.length; i++) {
        if (field[i].checked) return String(field[i].value || '').trim();
      }
      return '';
    }
    if (field.type === 'checkbox') return field.checked ? String(field.value || 'yes') : '';
    return String(field.value || '').trim();
  }

  function clientProblem(values) {
    if (!values.name) return 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email) || values.email.length > 254) {
      return 'Enter a valid email address.';
    }
    if (!values.phone) return 'Enter your phone number.';
    if (!normalisePhone(values.phone).ok) return 'Enter a valid phone number.';
    if (!values.service) return 'Choose the service you need.';
    if (!values.message) return 'Describe your project.';
    if (values.fax_number) return 'Check the enquiry and try again.';
    return '';
  }

  function normalisePhone(raw) {
    var original = String(raw || '').trim();
    if (!original) return { ok: false, missing: true };
    if (original.length > 40) return { ok: false };
    var compact = original.replace(/[\s()./-]/g, '');
    if (!/^\+?\d+$/.test(compact)) return { ok: false };
    var digits = compact.charAt(0) === '+' ? compact.slice(1) : compact;
    if (digits.length === 11 && digits.slice(0, 2) === '27') {
      return { ok: /^[1-9][0-9]{8}$/.test(digits.slice(2)) };
    }
    if (digits.length === 10 && digits.charAt(0) === '0') {
      return { ok: /^[1-9][0-9]{8}$/.test(digits.slice(1)) };
    }
    if (compact.charAt(0) === '+' && digits.length >= 8 && digits.length <= 15 && digits.charAt(0) !== '0') {
      return { ok: true };
    }
    return { ok: false };
  }

  function isTrustedEnquiryOrigin(origin) {
    if (!origin) return false;
    if (origin === 'https://script.google.com') return true;
    return /^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/i.test(origin);
  }

  function defaultKey() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0').slice(-12);
  }

  root.createEnquiryController = createEnquiryController;
  root.isTrustedEnquiryOrigin = isTrustedEnquiryOrigin;
})(typeof window !== 'undefined' ? window : this);
