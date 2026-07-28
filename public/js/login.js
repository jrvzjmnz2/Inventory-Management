// If already logged in, skip straight to the dashboard.
if (sessionStorage.getItem('employeeId')) {
  window.location.href = 'dashboard.html';
}

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const employeeId = document.getElementById('employeeId').value.trim();
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, password })
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.message || 'Login failed.';
      return;
    }

    sessionStorage.setItem('employeeId', data.employeeId);
    sessionStorage.setItem('employeeName', data.name);
    window.location.href = 'dashboard.html';
  } catch (err) {
    errEl.textContent = 'Could not reach the server. Is it running?';
  }
});

document.getElementById('showRegister').addEventListener('click', () => {
  loginForm.classList.add('hidden');
  document.getElementById('showRegister').classList.add('hidden');
  registerForm.classList.remove('hidden');
  document.getElementById('showLogin').classList.remove('hidden');
});

document.getElementById('showLogin').addEventListener('click', () => {
  registerForm.classList.add('hidden');
  document.getElementById('showLogin').classList.add('hidden');
  loginForm.classList.remove('hidden');
  document.getElementById('showRegister').classList.remove('hidden');
});

// Shows the "Account Created Successfully" popup, holds it on screen briefly,
// fades it out over 1s (see .success-popup's CSS transition), then runs
// `onDone` - used to return to the login screen once it's gone.
const registerSuccessPopup = document.getElementById('registerSuccessPopup');

function showSuccessPopup(onDone) {
  registerSuccessPopup.classList.remove('hidden', 'fade-out');
  setTimeout(() => {
    registerSuccessPopup.classList.add('fade-out');
  }, 1400);
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
      body: JSON.stringify({ employeeId, name, password, accessCode })
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.message || 'Registration failed.';
      return;
    }

    registerForm.reset();
    showSuccessPopup(() => {
      registerForm.classList.add('hidden');
      document.getElementById('showLogin').classList.add('hidden');
      loginForm.classList.remove('hidden');
      document.getElementById('showRegister').classList.remove('hidden');
    });
  } catch (err) {
    errEl.textContent = 'Could not reach the server. Is it running?';
  }
});
