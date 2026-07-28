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
    const res = await fetch(apiUrl('/api/auth/login'), {
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

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const employeeId = document.getElementById('regId').value.trim();
  const name = document.getElementById('regName').value.trim();
  const password = document.getElementById('regPassword').value;
  const errEl = document.getElementById('registerError');
  const okEl = document.getElementById('registerSuccess');
  errEl.textContent = '';
  okEl.textContent = '';

  try {
    const res = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, name, password })
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.message || 'Registration failed.';
      return;
    }

    okEl.textContent = 'Registration successful. You can now log in.';
    registerForm.reset();
  } catch (err) {
    errEl.textContent = 'Could not reach the server. Is it running?';
  }
});
