/**
 * Contact-form controller. Loaded on contact.html before js/script.js.
 * The upstream lead-service address and proxy token are intentionally absent.
 */
(function (root) {
  var SUCCESS_MESSAGE = 'Thank you. Your enquiry has been received. We will contact you about it.';
  var FAILURE_MESSAGE = 'We could not send your enquiry. Please try again, or email lesleysacks1@gmail.com or call 084 325 2262.';
  var SENDING_MESSAGE = 'Sending your enquiry.';
  var SAFE_MESSAGE = /^[A-Za-z0-9 ,.'’\-()]{8,200}$/;

  function createEnquiryController(options) {
    var form = options.form;
    var fetchImpl = options.fetchImpl || root.fetch;
    var createKey = options.createKey || defaultKey;
    var pagePath = options.pagePath;
    var status = form.querySelector('#form-status');
    var button = form.querySelector('button[type="submit"]');
    var label = button ? button.querySelector('.button-label') : null;
    var spinner = button ? button.querySelector('.form-spinner') : null;
    var idleLabel = label ? label.textContent : 'Send enquiry';
    var submissionKey = '';
    var busy = false;

    function onSubmit(event) {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (busy) return Promise.resolve();

      var values = readForm(form);
      var problem = clientProblem(values);
      if (problem) {
        setStatus(problem, true, false);
        if (typeof form.reportValidity === 'function') form.reportValidity();
        return Promise.resolve();
      }
      if (typeof form.reportValidity === 'function' && form.reportValidity() === false) {
        return Promise.resolve();
      }

      busy = true;
      setLoading(true);
      setStatus(SENDING_MESSAGE, false, false);
      var key = currentKey();
      var payload = {
        name: values.name,
        email: values.email,
        business: values.business,
        phone: values.phone,
        service: values.service,
        message: values.message,
        consent: true,
        page: currentPage(),
        submissionKey: key,
        fax_number: values.fax_number
      };

      return Promise.resolve()
        .then(function () {
          return fetchImpl(endpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload),
            credentials: 'omit'
          });
        })
        .then(function (response) {
          return readJson(response).then(function (data) {
            if (response && response.ok && data && data.ok === true && typeof data.leadId === 'string' && data.leadId.trim()) {
              if (typeof form.reset === 'function') form.reset();
              submissionKey = '';
              setStatus(SUCCESS_MESSAGE, false, true);
              return;
            }
            var forwarded = data && typeof data.message === 'string' ? data.message.trim() : '';
            var statusCode = response && response.status;
            if ((statusCode === 400 || statusCode === 429 || statusCode === 503) && SAFE_MESSAGE.test(forwarded)) {
              setStatus(forwarded, true, false);
              return;
            }
            setStatus(FAILURE_MESSAGE, true, false);
          });
        })
        .catch(function () {
          setStatus(FAILURE_MESSAGE, true, false);
        })
        .finally(function () {
          busy = false;
          setLoading(false);
        });
    }

    form.addEventListener('submit', onSubmit);
    // Constraint validation blocks the submit event, so the live region is
    // updated from the invalid event that the browser fires instead.
    form.addEventListener('invalid', function () {
      var problem = clientProblem(readForm(form));
      if (problem) setStatus(problem, true, false);
    }, true);

    function currentKey() {
      if (!submissionKey) submissionKey = createKey();
      return submissionKey;
    }

    function currentPage() {
      if (pagePath) return pagePath;
      try {
        var path = root.location && root.location.pathname;
        if (path && path.charAt(0) === '/') return path.split('?')[0].split('#')[0];
      } catch (error) {
        // Ignore a blocked location object and record the contact page.
      }
      return '/contact.html';
    }

    function endpoint() {
      var configured = form.getAttribute('data-enquiry-endpoint');
      if (configured && String(configured).trim()) return String(configured).trim();
      return '/api/enquiry';
    }

    function setLoading(loading) {
      form.setAttribute('aria-busy', loading ? 'true' : 'false');
      if (!button) return;
      button.disabled = loading;
      button.classList.toggle('is-loading', loading);
      button.setAttribute('aria-disabled', loading ? 'true' : 'false');
      if (label) label.textContent = loading ? 'Sending' : idleLabel;
      if (spinner) spinner.hidden = !loading;
    }

    function setStatus(text, isError, isSuccess) {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('is-error', isError);
      status.classList.toggle('is-success', isSuccess);
    }

    return { onSubmit: onSubmit };
  }

  function readForm(form) {
    return {
      name: fieldValue(form, 'name'),
      email: fieldValue(form, 'email'),
      business: fieldValue(form, 'business'),
      phone: fieldValue(form, 'phone'),
      service: fieldValue(form, 'service'),
      message: fieldValue(form, 'message'),
      consent: fieldValue(form, 'consent'),
      fax_number: fieldValue(form, 'fax_number')
    };
  }

  function fieldValue(form, name) {
    if (!form.elements || typeof form.elements.namedItem !== 'function') return '';
    var field = form.elements.namedItem(name);
    if (!field) return '';
    if (field.type === 'checkbox') return field.checked ? String(field.value || 'yes') : '';
    return String(field.value || '').trim();
  }

  function clientProblem(values) {
    if (!values.name) return 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email) || values.email.length > 254) {
      return 'Enter a valid email address.';
    }
    var phone = normalisePhone(values.phone);
    if (!phone.ok) return 'Enter a valid South African phone number, or leave the phone field blank.';
    if (!values.service) return 'Choose the service you need.';
    if (!values.message) return 'Describe your project.';
    if (!values.consent) return 'Agree to be contacted about this enquiry before sending it.';
    if (values.fax_number) return 'Check the enquiry and try again.';
    return '';
  }

  function normalisePhone(raw) {
    var original = String(raw || '').trim();
    if (!original) return { ok: true };
    if (original.length > 40) return { ok: false };
    var compact = original.replace(/[\s()./-]/g, '');
    if (!/^\+?\d+$/.test(compact)) return { ok: false };
    var digits = compact.charAt(0) === '+' ? compact.slice(1) : compact;
    var national = '';
    if (digits.length === 11 && digits.slice(0, 2) === '27') national = digits.slice(2);
    else if (digits.length === 10 && digits.charAt(0) === '0') national = digits.slice(1);
    else return { ok: false };
    if (!/^[1-9][0-9]{8}$/.test(national)) return { ok: false };
    return { ok: true };
  }

  function readJson(response) {
    if (!response || typeof response.json !== 'function') return Promise.resolve(null);
    return response.json().catch(function () { return null; });
  }

  function defaultKey() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0').slice(-12);
  }

  root.createEnquiryController = createEnquiryController;
})(typeof window !== 'undefined' ? window : this);
