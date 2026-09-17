/**
 * Roles y permisos en la interfaz (punto 8 de la fase 5).
 *
 * La autoridad es el servidor (`resolveBoardAccess`); acá vive **la copia** que
 * la interfaz necesita para no dejar intentar lo que no se puede y para poder
 * explicarlo. El rol llega por dos caminos:
 *
 * 1. `BoardSummary.role` de la API (`GET /api/boards/:id`, catálogo, invitación).
 * 2. El rechazo del socket: si el servidor no autentica la conexión de
 *    colaboración, el rol queda en solo lectura aunque el resto no lo diga.
 *
 * Este módulo es puro (sin React ni red) para poder probarlo y para que las
 * superficies compartan la misma matriz de capacidades.
 */

import {
  type BoardRole,
  type EffectiveRole,
  BOARD_ROLES,
  canComment,
  canEdit,
  canView,
} from '@tablero/shared';

export type { BoardRole, EffectiveRole };

/** Roles que se pueden conceder con una invitación o un cambio de miembro. */
export const ASSIGNABLE_ROLES: BoardRole[] = ['viewer', 'commenter', 'editor'];

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  owner: 'Propietario',
  editor: 'Editor',
  commenter: 'Comentarista',
  viewer: 'Lector',
};

export const ROLE_DESCRIPTIONS: Record<BoardRole, string> = {
  editor: 'Puede ver y editar el tablero: crear, mover y borrar tarjetas.',
  commenter: 'Puede ver el tablero y comentar. No puede editar tarjetas.',
  viewer: 'Solo puede ver el tablero. No puede editar ni comentar.',
};

/** Capacidad de la interfaz: lo que el rol habilita a intentar. */
export type Capability = 'view' | 'comment' | 'edit' | 'manage' | 'publish';

const CAPABILITY_LABELS: Record<Capability, string> = {
  view: 'ver el tablero',
  comment: 'comentar',
  edit: 'editar el tablero',
  manage: 'gestionar miembros',
  publish: 'publicar el tablero',
};

/** ¿El rol concede la capacidad? `null` (desconocido) no concede nada. */
export function can(role: EffectiveRole | null | undefined, capability: Capability): boolean {
  switch (capability) {
    case 'view':
      return canView(role ?? null);
    case 'comment':
      return canComment(role ?? null);
    case 'edit':
      return canEdit(role ?? null);
    case 'manage':
    case 'publish':
      return role === 'owner';
    default:
      return false;
  }
}

/** Todas las capacidades de un rol (para pintar el resumen del diálogo). */
export function capabilitiesFor(role: EffectiveRole | null | undefined): Record<Capability, boolean> {
  return {
    view: can(role, 'view'),
    comment: can(role, 'comment'),
    edit: can(role, 'edit'),
    manage: can(role, 'manage'),
    publish: can(role, 'publish'),
  };
}

/** Un rol que no puede escribir (lector o comentarista). */
export function isReadOnlyRole(role: EffectiveRole | null | undefined): boolean {
  return !can(role, 'edit');
}

/**
 * Motivo legible por el que una acción no está disponible. Devuelve `null`
 * cuando el rol sí puede hacerla (o cuando el rol todavía se desconoce: en ese
 * caso la interfaz no bloquea, para no romper el uso en local).
 */
export function capabilityRefusal(
  role: EffectiveRole | null | undefined,
  capability: Capability,
): string | null {
  if (!role) return null;
  if (can(role, capability)) return null;
  const action = CAPABILITY_LABELS[capability];
  if (role === 'viewer' || role === 'commenter') {
    return `Tu rol en este tablero (${ROLE_LABELS[role]}) no permite ${action}.`;
  }
  return `No tienes permiso para ${action}.`;
}

/** Texto que explica el modo lectura en la barra superior. */
export function readOnlyNotice(role: EffectiveRole): string {
  if (role === 'commenter') {
    return 'Estás como comentarista: puedes leer y comentar, pero no editar el tablero.';
  }
  if (role === 'viewer') {
    return 'Estás como lector: el tablero se abre en solo lectura.';
  }
  return 'El tablero está en solo lectura.';
}

const RANK: Record<EffectiveRole, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

export function roleRank(role: EffectiveRole | null | undefined): number {
  return role ? RANK[role] : 0;
}

/** ¿`role` alcanza al menos `minimum`? */
export function roleAtLeast(
  role: EffectiveRole | null | undefined,
  minimum: EffectiveRole,
): boolean {
  return roleRank(role) >= RANK[minimum];
}

/** Normaliza un valor que llega de la API (o de localStorage) a un rol. */
export function parseRole(value: unknown): EffectiveRole | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'owner') return 'owner';
  if ((BOARD_ROLES as readonly string[]).includes(normalized)) return normalized as BoardRole;
  return null;
}

/** ¿El valor es un rol asignable (no `owner`)? */
export function parseAssignableRole(value: unknown): BoardRole | null {
  const role = parseRole(value);
  return role && role !== 'owner' ? role : null;
}

/**
 * Rol de la interfaz a partir de la sesión de colaboración y del rechazo del
 * socket. El rechazo manda: si el servidor no autenticó la conexión, la
 * interfaz no puede creer que tiene permiso de escritura.
 */
export function effectiveUiRole(input: {
  role: EffectiveRole | null;
  socketRejected: boolean;
  forcedReadOnly?: boolean;
}): EffectiveRole | null {
  if (input.forcedReadOnly) return 'viewer';
  if (input.socketRejected) {
    // Con el documento ya cargado por REST el rechazo deja lectura; sin
    // documento no hay nada que mostrar y el rol queda desconocido.
    if (input.role === 'owner' || input.role === 'editor') return 'viewer';
    return input.role ?? 'viewer';
  }
  return input.role;
}
