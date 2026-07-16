document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('#payment-form');
  if (!form) return;
  const message = document.querySelector('#payment-message');
  const submit = form.querySelector('button[type="submit"]');
  const setMessage = (text, isError = false) => { message.textContent = text; message.classList.toggle('is-error', isError); };
  const api = async (path, payload) => {
    const response = await fetch(`/.netlify/functions/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  };
  const params = new URLSearchParams(window.location.search);
  if (params.get('payfast') === 'success') setMessage('Your PayFast payment is being confirmed. We will update your invoice once confirmation is received.');
  if (params.get('payfast') === 'cancelled' || params.get('paypal') === 'cancelled') setMessage('Your payment was cancelled. No payment has been taken.', true);
  if (params.get('paypal') === 'success' && params.get('token')) {
    setMessage('Confirming your PayPal payment...');
    api('paypal-capture-order', { orderId: params.get('token') })
      .then((data) => setMessage(data.status === 'COMPLETED' ? `Payment received for invoice ${data.invoiceNumber}. Thank you.` : 'Your PayPal payment is still being processed.'))
      .catch((error) => setMessage(error.message, true));
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const payload = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    setMessage('Preparing your secure checkout...');
    try {
      if (payload.provider === 'payfast') {
        const { checkoutUrl, fields } = await api('payfast-create', payload);
        const checkout = document.createElement('form');
        checkout.method = 'post'; checkout.action = checkoutUrl;
        Object.entries(fields).forEach(([name, value]) => { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; checkout.appendChild(input); });
        document.body.appendChild(checkout); checkout.submit();
      } else {
        const { approvalUrl } = await api('paypal-create-order', payload);
        window.location.assign(approvalUrl);
      }
    } catch (error) { setMessage(error.message, true); submit.disabled = false; }
  });
});
