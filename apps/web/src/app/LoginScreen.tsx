import { useState, type FormEvent } from 'react';
import { loginWithPassword } from '../matrix/login';
import './LoginScreen.css';

type LoginScreenProps = {
  onLoggedIn: () => void;
  onSwitchToRegister: () => void;
};

export function LoginScreen({ onLoggedIn, onSwitchToRegister }: LoginScreenProps) {
  const [server, setServer] = useState('matrix.org');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      await loginWithPassword(server, username, password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="nu-login" data-nu-role="login-screen">
      <form className="nu-login__form" onSubmit={handleSubmit}>
        <h1 className="nu-login__title">NekoUs</h1>
        <label className="nu-login__field">
          Homeserver
          <input
            className="nu-login__input"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="matrix.org or https://your-server"
          />
        </label>
        <label className="nu-login__field">
          Username
          <input
            className="nu-login__input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="nu-login__field">
          Password
          <input
            className="nu-login__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p className="nu-login__error" data-nu-role="login-error">
            {error}
          </p>
        )}
        <button className="nu-login__submit" type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
        <button type="button" className="nu-login__switch" onClick={onSwitchToRegister} disabled={submitting}>
          Need an account? Register
        </button>
      </form>
    </div>
  );
}
