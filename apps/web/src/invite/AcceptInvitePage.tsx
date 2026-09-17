/**
 * Ruta de invitación: `/invite/:token` (punto 1 de la fase 5).
 *
 * Muestra de qué tablero es la invitación y con qué rol; si no hay sesión, pide
 * registrarse o entrar (la invitación es para un email concreto, así que la
 * cuenta tiene que coincidir). Al aceptar, el tablero queda en el catálogo y se
 * abre sin recargar.
 */

import { useEffect, useState } from 'react';

import { CheckCircle2, LogIn, Mail, TriangleAlert, UserPlus } from 'lucide-react';

import { acceptInvitation, fetchInvitation, type InvitationPreview } from '@/api/sharing';
import { degradationMessage, isMissingEndpoint } from '@/api/degraded';
import { login, register } from '@/api/boards';
import { resumeAfterAuth } from '@/app/boardService';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/collab/roles';
import { appUrl } from '@/lib/routes';
import { useNoindex } from '@/lib/noindex';
import { useAppStore } from '@/state/appStore';

type Mode = 'login' | 'register';

export function AcceptInvitePage({ token }: { token: string }): JSX.Element {
  useNoindex();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ boardId: string | null; title: string } | null>(null);
  const [mode, setMode] = useState<Mode>('register');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const user = useAppStore((state) => state.user);
  const authRequired = useAppStore((state) => state.authRequired);

  useEffect(() => {
    let cancelled = false;
    void fetchInvitation(token)
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setEmail(result.invitation.email);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          isMissingEndpoint(cause)
            ? 'La API todavía no expone las invitaciones.'
            : degradationMessage(cause, 'Abrir la invitación'),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const signedIn = !authRequired && user.id !== 'local-user' && user.email.length > 0;

  const accept = async (): Promise<void> => {
    setBusy(true);
    setAuthError(null);
    try {
      const result = await acceptInvitation(token);
      await resumeAfterAuth();
      const boardId = result.board?.id ?? preview?.board?.id ?? null;
      if (boardId) {
        useAppStore.getState().setCurrentBoard(boardId);
      }
      setAccepted({ boardId, title: result.board?.title ?? preview?.board?.title ?? 'el tablero' });
    } catch (cause) {
      setAuthError(degradationMessage(cause, 'Aceptar la invitación'));
    } finally {
      setBusy(false);
    }
  };

  const submitAuth = async (): Promise<void> => {
    setBusy(true);
    setAuthError(null);
    try {
      const target = email.trim();
      const result =
        mode === 'register'
          ? await register({ email: target, name: name.trim() || target, password })
          : await login({ email: target, password });
      useAppStore.getState().setUser(result.user);
      useAppStore.getState().setAuthRequired(false);
      setPassword('');
    } catch (cause) {
      setAuthError(degradationMessage(cause, mode === 'register' ? 'Crear la cuenta' : 'Entrar'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="invite-page">
        <div className="invite-card" data-invite-loading>
          <p>Cargando la invitación…</p>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="invite-page">
        <div className="invite-card" data-invite-accepted>
          <h1 className="invite-card__title">
            <CheckCircle2 size={18} /> Invitación aceptada
          </h1>
          <p className="invite-card__text">
            Ya tienes acceso a <strong>{accepted.title}</strong>. El tablero queda en tu catálogo.
          </p>
          <a className="invite-card__primary" href={appUrl(accepted.boardId)}>
            Abrir el tablero
          </a>
        </div>
      </div>
    );
  }

  if (error && !preview) {
    return (
      <div className="invite-page">
        <div className="invite-card" data-invite-error>
          <h1 className="invite-card__title">
            <TriangleAlert size={18} /> No se pudo abrir la invitación
          </h1>
          <p className="invite-card__text">{error}</p>
          <a className="invite-card__link" href={appUrl()}>
            Volver a la aplicación
          </a>
        </div>
      </div>
    );
  }

  const invitation = preview!.invitation;
  const alreadyAccepted = invitation.acceptedAt !== null;

  return (
    <div className="invite-page">
      <div className="invite-card" data-invite-card data-invite-role={invitation.role}>
        <h1 className="invite-card__title">
          <Mail size={18} /> Te invitaron a <strong>{preview?.board?.title ?? 'un tablero'}</strong>
        </h1>
        <p className="invite-card__text">
          Rol: <strong data-invite-role-label>{ROLE_LABELS[invitation.role]}</strong> — {ROLE_DESCRIPTIONS[invitation.role]}
        </p>
        <p className="invite-card__meta">
          Invitación para <strong>{invitation.email}</strong>
          {invitation.expiresAt ? ` · caduca el ${new Date(invitation.expiresAt).toLocaleDateString('es')}` : ''}
        </p>

        {alreadyAccepted ? (
          <p className="invite-card__warning" data-invite-used>
            Esta invitación ya se había aceptado. Si tu cuenta coincide, el tablero ya está en tu catálogo.
          </p>
        ) : null}

        {signedIn ? (
          <button
            type="button"
            className="invite-card__primary"
            data-invite-accept
            disabled={busy}
            onClick={() => void accept()}
          >
            {busy ? 'Aceptando…' : 'Aceptar invitación'}
          </button>
        ) : (
          <form
            className="invite-card__form"
            data-invite-auth
            onSubmit={(event) => {
              event.preventDefault();
              void submitAuth();
            }}
          >
            <p className="invite-card__text">
              {mode === 'register'
                ? 'Crea la cuenta con este email para aceptar.'
                : 'Entra con la cuenta de este email para aceptar.'}
            </p>
            <input
              className="invite-card__input"
              type="email"
              placeholder="tu@email.com"
              aria-label="Email"
              data-invite-email
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {mode === 'register' ? (
              <input
                className="invite-card__input"
                type="text"
                placeholder="Tu nombre"
                aria-label="Nombre"
                data-invite-name
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            ) : null}
            <input
              className="invite-card__input"
              type="password"
              placeholder="Contraseña"
              aria-label="Contraseña"
              data-invite-password
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="submit" className="invite-card__primary" data-invite-submit disabled={busy}>
              {mode === 'register' ? <UserPlus size={14} /> : <LogIn size={14} />}
              {mode === 'register' ? ' Crear cuenta y aceptar' : ' Entrar y aceptar'}
            </button>
            <button
              type="button"
              className="invite-card__link"
              data-invite-switch
              onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
            >
              {mode === 'register' ? 'Ya tengo cuenta' : 'Crear una cuenta nueva'}
            </button>
          </form>
        )}

        {authError ? (
          <p className="invite-card__warning" data-invite-auth-error>
            {authError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
