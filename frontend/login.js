async function init() {
  const res = await fetch('/api/auth/status');
  const status = await res.json();

  if (status.authenticated) {
    window.location.href = '/';
    return;
  }

  const isSetup = !status.passwordSet;
  const errorEl = document.getElementById('errorLogin');
  const submitBtn = document.getElementById('btnSubmitLogin');

  if (isSetup) {
    document.getElementById('loginTitle').textContent = 'Configuration';
    document.getElementById('loginSubtitle').textContent =
      "Aucun mot de passe n'est configuré. Choisissez-en un pour protéger l'accès à cette application.";
    document.getElementById('labelConfirmPassword').hidden = false;
    document.getElementById('inputPasswordConfirm').required = true;
    submitBtn.textContent = 'Créer le mot de passe';
  }

  document.getElementById('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const password = document.getElementById('inputPassword').value;

    if (isSetup) {
      const confirmPassword = document.getElementById('inputPasswordConfirm').value;
      if (password.length < 4) {
        errorEl.textContent = 'Le mot de passe doit contenir au moins 4 caractères.';
        return;
      }
      if (password !== confirmPassword) {
        errorEl.textContent = 'Les mots de passe ne correspondent pas.';
        return;
      }
    }

    submitBtn.disabled = true;

    try {
      const endpoint = isSetup ? '/api/auth/setup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
      window.location.href = '/';
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
    }
  });
}

init();
