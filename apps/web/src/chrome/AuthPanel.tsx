/**
 * Acceso: entrar o crear cuenta.
 *
 * Aparece cuando la API está viva y responde 401 (hay servidor pero no sesión).
 * Antes de existir este panel, la app caía a modo local en silencio: se podía
 * trabajar, pero nada llegaba al servidor y no había forma de iniciar sesión
 * desde la interfaz. El panel nunca bloquea: siempre se puede seguir sin cuenta,
 * y lo que ya esté creado en local se adopta al entrar.
 */

import { useEffect, useRef, useState } from 'react';

import { login, register } from '@/api/boards';
import { ApiError, API_BASE_URL } from '@/api/client';
import { resumeAfterAuth } from '@/app/boardService';
import { useAppStore } from '@/state/appStore';

type Mode = 'login' | 'register';

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isOffline) return 'No se pudo contactar con el servidor. Probá de nuevo en un momento.';
    if (error.status === 401) return 'Email o contraseña incorrectos.';
    if (error.status === 409) return 'Ya existe una cuenta con ese email. Probá entrar.';
    return error.message;
  }
  return 'Algo salió mal. Probá de nuevo.';
}

export function AuthPanel(): JSX.Element {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, [mode]);

  const switchMode = (next: Mode): void => {
    if (next === mode) return;
    setMode(next);
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (pending) return;

    const trimmedEmail = email.trim();
    setError(null);
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Escribí un email válido.');
      return;
    }
    if (mode === 'register' && name.trim().length === 0) {
      setError('Escribí tu nombre.');
      return;
    }
    if (password.length === 0) {
      setError('Escribí tu contraseña.');
      return;
    }
    if (mode === 'register' && password.length < MIN_PASSWORD) {
      setError(`La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }

    setPending(true);
    try {
      const result =
        mode === 'register'
          ? await register({ email: trimmedEmail, name: name.trim(), password })
          : await login({ email: trimmedEmail, password });
      setPassword('');
      const store = useAppStore.getState();
      store.setUser(result.user);
      store.setAuthRequired(false);
      await resumeAfterAuth();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <span className="auth__logo" aria-hidden="true">
            ◧
          </span>
          <h1 className="auth__title">Tablero</h1>
        </div>

        <div className="auth__tabs" role="tablist" aria-label="Acceso">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth__tab ${mode === 'login' ? 'is-active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Entrar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth__tab ${mode === 'register' ? 'is-active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Crear cuenta
          </button>
        </div>

        <form className="auth__form" onSubmit={submit} noValidate>
          <label className="auth__field">
            <span className="auth__label">Email</span>
            <input
              ref={firstField}
              className="auth__input"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tu@email.com"
              disabled={pending}
            />
          </label>

          {mode === 'register' ? (
            <label className="auth__field">
              <span className="auth__label">Nombre</span>
              <input
                className="auth__input"
                type="text"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Cómo te llamás"
                disabled={pending}
              />
            </label>
          ) : null}

          <label className="auth__field">
            <span className="auth__label">Contraseña</span>
            <input
              className="auth__input"
              type="password"
              name="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'register' ? `Al menos ${MIN_PASSWORD} caracteres` : 'Tu contraseña'}
              disabled={pending}
            />
          </label>

          <p className="auth__error" role="alert">
            {error ?? ''}
          </p>

          <button className="auth__submit" type="submit" disabled={pending}>
            {pending ? 'Un momento…' : mode === 'register' ? 'Crear cuenta' : 'Entrar'}
          </button>
        </form>

        <div className="auth__footer">
          <button
            type="button"
            className="auth__skip"
            onClick={() => useAppStore.getState().setAuthRequired(false)}
          >
            Seguir sin cuenta (solo en este navegador)
          </button>
          <p className="auth__hint">Servidor: {API_BASE_URL}</p>
        </div>
      </div>
    </div>
  );
}
