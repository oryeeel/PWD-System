(() => {
  const token = location.hash.slice(1);
  history.replaceState(null,'',location.pathname);
  const form = document.querySelector('#setup-form');
  const status = document.querySelector('#status');
  const error = document.querySelector('#error');
  const {passwordError,PASSWORD_REQUIREMENTS} = window.PasswordPolicy;
  const passwordInput = document.querySelector('#password');
  const confirmationInput = document.querySelector('#confirmation');
  document.querySelector('#password-hint').textContent = PASSWORD_REQUIREMENTS;
  function validatePasswords() {
    passwordInput.setCustomValidity(passwordError(passwordInput.value));
    confirmationInput.setCustomValidity(confirmationInput.value && confirmationInput.value !== passwordInput.value ? 'Passwords do not match.' : '');
  }
  passwordInput.addEventListener('input',validatePasswords);
  confirmationInput.addEventListener('input',validatePasswords);
  const fields = ['fullname','email','username','password','confirmation'];
  const headers = {'X-Setup-Token':token,'Content-Type':'application/json'};
  document.querySelector('#show-password').addEventListener('change',event => {
    for (const name of ['password','confirmation']) document.getElementById(name).type = event.target.checked ? 'text' : 'password';
  });
  async function initialize() {
    try {
      const response = await fetch('/api/setup',{headers});
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      for (const name of ['fullname','email','username']) document.getElementById(name).value = result.prefill[name] || '';
      status.textContent = 'Enter your password here. You do not need to send it in chat.';
      form.hidden = false;
      document.querySelector('#password').focus();
    } catch (failure) {status.textContent = failure.message || 'Could not open setup. Ask the maintainer to open a new setup form.';}
  }
  form.addEventListener('submit',async event => {
    event.preventDefault();error.hidden = true;
    const body = Object.fromEntries(fields.map(name => [name,document.getElementById(name).value]));
    const invalidPassword = passwordError(body.password);
    if (invalidPassword) {error.textContent = invalidPassword;error.hidden = false;passwordInput.focus();return;}
    if (body.password !== body.confirmation) {error.textContent = 'Passwords do not match.';error.hidden = false;document.querySelector('#confirmation').focus();return;}
    form.querySelectorAll('input,button').forEach(element => element.disabled = true);
    try {
      const response = await fetch('/api/create-admin',{method:'POST',headers,body:JSON.stringify(body)});
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 500 || response.status === 410) form.hidden = true;
        throw new Error(result.message);
      }
      form.reset();form.hidden = true;
      status.textContent = 'Admin account created. Sign in with '+result.username+', then open Users to create staff accounts.';
      const link = document.querySelector('#sign-in');link.href = result.loginUrl;link.hidden = false;link.focus();
    } catch (failure) {
      if (form.hidden || failure instanceof TypeError) {form.hidden = true;status.textContent = failure.message || 'The setup result could not be confirmed. Ask the maintainer to check the account.';}
      else {error.textContent = failure.message;error.hidden = false;}
    } finally {form.querySelectorAll('input,button').forEach(element => element.disabled = false);}
  });
  void initialize();
})();
