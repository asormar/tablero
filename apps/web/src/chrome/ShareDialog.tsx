/**
 * Diálogo de compartir (punto 1 de la fase 5).
 *
 *   - Miembros con su rol; el dueño puede cambiarlo y expulsar (el suyo no).
 *   - Invitar por email con rol y caducidad del enlace.
 *   - Enlaces de invitación pendientes, con copiar enlace.
 *
 * Todo pasa por la API (`GET/POST/PATCH/DELETE /boards/:id/members` y
 * `/boards/:id/invitations`). Si el endpoint todavía no está, el diálogo **no se
 * rompe**: lo dice y deja seguir trabajando.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Copy, Link2, Mail, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';

import { reportActivity } from '@/api/activity';
import { degradationMessage, isMissingEndpoint } from '@/api/degraded';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  addMember,
  createInvitation,
  listInvitations,
  removeMember,
  revokeInvitation,
  updateMemberRole,
  type BoardMember,
  type Invitation,
} from '@/api/sharing';
import { invalidateMembers, useBoardMembers } from '@/collab/boardMembers';
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, parseAssignableRole } from '@/collab/roles';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';
import { inviteUrl } from '@/lib/routes';
import { writeSystemText } from '@/lib/clipboard';
import { useOutsideClose } from '@/chrome/useOutsideClose';

const EXPIRY_OPTIONS = [
  { value: 1, label: '1 día' },
  { value: 7, label: '7 días' },
  { value: 30, label: '30 días' },
];

function formatExpiry(at: number | null): string {
  if (!at) return 'sin caducidad';
  const days = Math.max(0, Math.round((at - Date.now()) / (24 * 60 * 60 * 1000)));
  if (days === 0) return 'vence hoy';
  if (days === 1) return 'vence mañana';
  return `vence en ${days} días`;
}

export function ShareDialog({ boardId }: { boardId: string }): JSX.Element | null {
  const open = usePanelsStore((state) => state.shareOpen);
  const setOpen = usePanelsStore((state) => state.setShareOpen);
  const board = useAppStore((state) => state.boards.find((item) => item.id === boardId) ?? null);
  const me = useAppStore((state) => state.user);
  const setNotice = useAppStore((state) => state.setNotice);
  const close = (): void => setOpen(false);
  const ref = useOutsideClose<HTMLDivElement>(open, close);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const attachRef = useCallback(
    (node: HTMLDivElement | null): void => {
      ref.current = node;
      trapRef.current = node;
    },
    [ref, trapRef],
  );

  const { members, error, missing, reload } = useBoardMembers(boardId, { ownerId: board?.ownerId ?? null });
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'commenter' | 'editor'>('editor');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Texto para el anuncio accesible de las acciones asíncronas (`role=status`). */
  const [status, setStatus] = useState('');

  const myRole = board?.role ?? null;
  const isOwner =
    myRole === 'owner' ||
    (!myRole && members.some((member) => member.userId === me.id && member.isOwner));
  const myMember = members.find((member) => member.userId === me.id);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    void listInvitations(boardId)
      .then((list) => {
        if (!cancelled) setInvitations(list);
      })
      .catch(() => {
        // Sin endpoint de invitaciones no hay lista: el resto del diálogo sigue.
        if (!cancelled) setInvitations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, open]);

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      return a.name.localeCompare(b.name);
    });
  }, [members]);

  if (!open) return null;

  const copy = async (text: string, key: string): Promise<void> => {
    const ok = await writeSystemText(text);
    setCopied(ok ? key : null);
    if (!ok) setNotice('El navegador no dejó copiar al portapapeles. Copia el enlace a mano.');
  };

  const invite = async (): Promise<void> => {
    const target = email.trim();
    if (target.length === 0 || busy) return;
    setBusy(true);
    setInviteError(null);
    setStatus(`Enviando la invitación a ${target}…`);
    try {
      const invitation = await createInvitation(boardId, { email: target, role, expiresInDays });
      const link = inviteUrl(invitation.token);
      setInvitations((current) => [invitation, ...current]);
      setLastLink(link);
      setStatus(`Invitación enviada a ${target}.`);
      setEmail('');
      void copy(link, invitation.id);
      reportActivity(boardId, { action: 'member.invite', meta: { email: target, role } });
      setNotice(`Invitación enviada a ${target} (caduca en ${expiresInDays} día(s)).`);
    } catch (error) {
      const message = isMissingEndpoint(error)
        ? 'La API todavía no expone las invitaciones.'
        : degradationMessage(error, 'Invitar');
      setInviteError(message);
      setStatus(`No se pudo invitar a ${target}.`);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: BoardMember, next: 'viewer' | 'commenter' | 'editor'): Promise<void> => {
    setStatus(`Cambiando el rol de ${member.name}…`);
    try {
      await updateMemberRole(boardId, member.userId, next);
      invalidateMembers(boardId);
      reload();
      setStatus(`Rol de ${member.name}: ${ROLE_LABELS[next]}.`);
      reportActivity(boardId, { action: 'member.role', meta: { userId: member.userId, role: next } });
    } catch (error) {
      setNotice(degradationMessage(error, 'Cambiar el rol'));
      setStatus(`No se pudo cambiar el rol de ${member.name}.`);
    }
  };

  const kick = async (member: BoardMember): Promise<void> => {
    setStatus(`Quitando a ${member.name}…`);
    try {
      await removeMember(boardId, member.userId);
      invalidateMembers(boardId);
      reload();
      setStatus(`${member.name} ya no tiene acceso al tablero.`);
      reportActivity(boardId, { action: 'member.remove', meta: { userId: member.userId } });
    } catch (error) {
      setNotice(degradationMessage(error, 'Quitar al miembro'));
      setStatus(`No se pudo quitar a ${member.name}.`);
    }
  };

  const publicSlug = board?.publishedSlug ?? null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Compartir el tablero"
        data-share-dialog
        ref={attachRef}
      >
        <div className="modal__head">
          <h2 className="modal__title">
            <ShieldCheck size={15} /> Compartir «{board?.title ?? 'Tablero'}»
          </h2>
          <button type="button" className="icon-button" title="Cerrar" aria-label="Cerrar" onClick={close}>
            <X size={14} />
          </button>
        </div>

        <div className="modal__body">
          <p className="sr-only" role="status" data-share-status>
            {status}
          </p>

          <p className="share-dialog__role" data-share-role={myRole ?? 'unknown'}>
            Tu rol:{' '}
            <strong>{myRole ? ROLE_LABELS[myRole] : myMember ? ROLE_LABELS[myMember.role] : 'desconocido'}</strong>
            {isOwner ? ' · puedes gestionar los miembros' : ' · solo el dueño gestiona los miembros'}
          </p>

          {missing ? (
            <p className="share-dialog__warning" data-share-missing>
              La API todavía no expone los miembros de este tablero: se muestran los que ya había en caché.
            </p>
          ) : null}
          {error && !missing ? <p className="share-dialog__warning">{error}</p> : null}

          <section className="share-dialog__section">
            <h3 className="share-dialog__heading">Miembros ({sortedMembers.length || 1})</h3>
            <ul className="share-dialog__members" data-share-members={sortedMembers.length}>
              {sortedMembers.length === 0 ? (
                <li className="share-dialog__member" data-share-owner-self>
                  <span className="share-dialog__member-name">{me.name} (tú)</span>
                  <span className="share-dialog__member-role">{myRole ? ROLE_LABELS[myRole] : 'Propietario'}</span>
                </li>
              ) : (
                sortedMembers.map((member) => (
                  <li key={member.userId} className="share-dialog__member" data-share-member={member.userId}>
                    <span className="share-dialog__member-name">
                      {member.name}
                      {member.userId === me.id ? ' (tú)' : ''}
                    </span>
                    {member.email ? <span className="share-dialog__member-email">{member.email}</span> : null}
                    {member.isOwner ? (
                      <span className="share-dialog__member-role" data-member-owner>
                        Propietario
                      </span>
                    ) : isOwner ? (
                      <>
                        <select
                          className="share-dialog__select"
                          value={member.role === 'owner' ? 'editor' : member.role}
                          aria-label={`Rol de ${member.name}`}
                          onChange={(event) => {
                            const next = parseAssignableRole(event.target.value);
                            if (next) void changeRole(member, next);
                          }}
                        >
                          {ASSIGNABLE_ROLES.map((option) => (
                            <option key={option} value={option}>
                              {ROLE_LABELS[option]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="icon-button"
                          title={`Expulsar a ${member.name}`}
                          aria-label={`Expulsar a ${member.name}`}
                          data-share-remove={member.userId}
                          onClick={() => void kick(member)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    ) : (
                      <span className="share-dialog__member-role">{ROLE_LABELS[member.role]}</span>
                    )}
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="share-dialog__section">
            <h3 className="share-dialog__heading">
              <UserPlus size={13} /> Invitar por email
            </h3>
            <div className="share-dialog__invite">
              <input
                className="share-dialog__input"
                type="email"
                placeholder="persona@ejemplo.com"
                aria-label="Email a invitar"
                data-autofocus
                data-share-email
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void invite();
                  }
                }}
              />
              <select
                className="share-dialog__select"
                value={role}
                aria-label="Rol de la invitación"
                data-share-invite-role
                onChange={(event) => setRole((parseAssignableRole(event.target.value) ?? 'editor') as 'viewer')}
              >
                {ASSIGNABLE_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
              <select
                className="share-dialog__select"
                value={expiresInDays}
                aria-label="Caducidad del enlace"
                data-share-expiry
                onChange={(event) => setExpiresInDays(Number(event.target.value))}
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="share-dialog__primary"
                data-share-invite-send
                disabled={busy || email.trim().length === 0}
                onClick={() => void invite()}
              >
                <Mail size={13} /> Invitar
              </button>
            </div>
            <p className="share-dialog__hint">{ROLE_DESCRIPTIONS[role]}</p>
            {inviteError ? <p className="share-dialog__warning" data-share-invite-error>{inviteError}</p> : null}
            {lastLink ? (
              <p className="share-dialog__link" data-share-last-link>
                <Link2 size={12} /> Enlace: <code>{lastLink}</code>
                <button type="button" className="icon-button" title="Copiar enlace" aria-label="Copiar enlace" onClick={() => void copy(lastLink, 'last')}>
                  <Copy size={12} />
                </button>
                {copied === 'last' ? <span className="share-dialog__copied">copiado</span> : null}
              </p>
            ) : null}
          </section>

          {invitations.length > 0 ? (
            <section className="share-dialog__section">
              <h3 className="share-dialog__heading">Invitaciones pendientes</h3>
              <ul className="share-dialog__invitations" data-share-invitations={invitations.length}>
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="share-dialog__invitation" data-share-invitation={invitation.id}>
                    <span className="share-dialog__member-name">{invitation.email}</span>
                    <span className="share-dialog__member-role">{ROLE_LABELS[invitation.role]}</span>
                    <span className="share-dialog__expiry">{formatExpiry(invitation.expiresAt)}</span>
                    <button
                      type="button"
                      className="icon-button"
                      title="Copiar enlace de invitación"
                      aria-label="Copiar enlace de invitación"
                      data-share-copy={invitation.id}
                      onClick={() => void copy(inviteUrl(invitation.token), invitation.id)}
                    >
                      <Copy size={12} />
                    </button>
                    {copied === invitation.id ? <span className="share-dialog__copied">copiado</span> : null}
                    <button
                      type="button"
                      className="icon-button"
                      title="Revocar invitación"
                      aria-label="Revocar invitación"
                      onClick={() => {
                        void revokeInvitation(invitation.id)
                          .then(() => setInvitations((current) => current.filter((item) => item.id !== invitation.id)))
                          .catch((error: unknown) => setNotice(degradationMessage(error, 'Revocar la invitación')));
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {publicSlug ? (
            <p className="share-dialog__published" data-share-published>
              Este tablero está publicado en <code>{`/p/${publicSlug}`}</code> (solo lectura, sin sesión).
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
