// Supabase can return an expired or completed email link to the configured
// public site URL. Route every such link to the dedicated Orbit auth screen.
const orbitAuthFragment = new URLSearchParams(window.location.hash.slice(1));
const orbitAuthQuery = new URLSearchParams(window.location.search);
if (orbitAuthFragment.has('access_token') || orbitAuthFragment.has('error') || orbitAuthFragment.has('type') || orbitAuthQuery.has('token_hash')) {
  window.location.replace(`orbit-console.html${window.location.search}${window.location.hash}`);
}

const demoForm = document.querySelector('#demo-request-form');
const demoStatus = document.querySelector('#demo-form-status');

// Arriving from a specific coming-soon page (?product=growth|competency)
// pre-selects that product instead of leaving the visitor to re-pick it.
const PRODUCT_LABELS = { growth: 'Orbit Growth', competency: 'Competency Management' };
const requestedProduct = PRODUCT_LABELS[orbitAuthQuery.get('product')];
if (requestedProduct) {
  const productField = demoForm.elements.product;
  if ([...productField.options].some((option) => option.value === requestedProduct)) {
    productField.value = requestedProduct;
  }
}

demoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  demoStatus.className = 'form-status';
  if (!demoForm.checkValidity()) {
    demoForm.reportValidity();
    return;
  }

  const submit = demoForm.querySelector('[type="submit"]');
  const payload = Object.fromEntries(new FormData(demoForm).entries());
  submit.disabled = true;
  submit.textContent = 'Sending request…';
  demoStatus.textContent = '';

  try {
    const response = await fetch('/api/demo-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'We could not send your request. Please try again shortly.');
    demoForm.reset();
    demoStatus.className = 'form-status success';
    demoStatus.textContent = 'Thank you — your request is with the Orbit team.';
  } catch (error) {
    demoStatus.className = 'form-status error';
    demoStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Request my demo <b>→</b>';
  }
});
