// Sign-in now happens only at the AI Hub - this page just creates the
// account (still gated by the shared access code). After registering,
// send the new employee to the Hub to actually log in.
const registerForm = document.getElementById('registerForm');
const registerSuccessPopup = document.getElementById('registerSuccessPopup');

function showSuccessPopup(onDone) {
  registerSuccessPopup.classList.remove('hidden', 'fade-out');
  setTimeout(() => registerSuccessPopup.classList.add('fade-out'), 1400);
  setTimeout(() => {
    registerSuccessPopup.classList.add('hidden');
    if (onDone) onDone();
  }, 2400);
}

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const employeeId = document.getElementById('regId').value.trim();
  const name = document.getElementById('regName').value.trim();
  const password = document.getElementById('regPassword').value;
  const accessCode = document.getElementById('regAccessCode').value;
  const errEl = document.getElementById('registerError');
  const okEl = document.getElementById('registerSuccess');
  errEl.textContent = '';
  okEl.textContent = '';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, name, password, accessCode }),
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.message || 'Registration failed.';
      return;
    }

    registerForm.reset();
    showSuccessPopup(() => {
      window.location.href = '/';
    });
  } catch (err) {
    errEl.textContent = 'Could not reach the server. Is it running?';
  }
});
