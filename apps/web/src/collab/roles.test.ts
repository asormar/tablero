/**
 * Roles y permisos de la interfaz (fase 5).
 *
 * Lo que se prueba acá es la copia que la interfaz usa para **no dejar
 * intentar** lo que el servidor va a rechazar, y el texto que lo explica.
 */

import { describe, expect, it } from 'vitest';

import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  can,
  capabilitiesFor,
  capabilityRefusal,
  effectiveUiRole,
  isReadOnlyRole,
  parseAssignableRole,
  parseRole,
  readOnlyNotice,
  roleAtLeast,
  roleRank,
} from './roles';

describe('roles · capacidades', () => {
  it('el dueño puede todo', () => {
    expect(capabilitiesFor('owner')).toEqual({
      view: true,
      comment: true,
      edit: true,
      manage: true,
      publish: true,
    });
  });

  it('el editor no gestiona miembros ni publica', () => {
    expect(can('editor', 'edit')).toBe(true);
    expect(can('editor', 'comment')).toBe(true);
    expect(can('editor', 'manage')).toBe(false);
    expect(can('editor', 'publish')).toBe(false);
  });

  it('el comentarista comenta pero no edita', () => {
    expect(can('commenter', 'comment')).toBe(true);
    expect(can('commenter', 'edit')).toBe(false);
    expect(can('commenter', 'view')).toBe(true);
  });

  it('el lector solo mira', () => {
    expect(can('viewer', 'view')).toBe(true);
    expect(can('viewer', 'comment')).toBe(false);
    expect(can('viewer', 'edit')).toBe(false);
  });

  it('un rol desconocido no concede nada (pero tampoco bloquea la vista)', () => {
    expect(can(null, 'edit')).toBe(false);
    expect(can(null, 'comment')).toBe(false);
    expect(can(null, 'manage')).toBe(false);
  });

  it('solo el dueño gestiona y publica', () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(can(role, 'manage')).toBe(false);
      expect(can(role, 'publish')).toBe(false);
    }
  });
});

describe('roles · lectura y explicaciones', () => {
  it('lector y comentarista son roles de solo lectura', () => {
    expect(isReadOnlyRole('viewer')).toBe(true);
    expect(isReadOnlyRole('commenter')).toBe(true);
    expect(isReadOnlyRole('editor')).toBe(false);
    expect(isReadOnlyRole('owner')).toBe(false);
    expect(isReadOnlyRole(null)).toBe(true);
  });

  it('explica por qué no se puede escribir', () => {
    expect(capabilityRefusal('viewer', 'edit')).toContain('Lector');
    expect(capabilityRefusal('commenter', 'edit')).toContain('Comentarista');
    expect(capabilityRefusal('editor', 'edit')).toBeNull();
  });

  it('explica por qué no se puede comentar con rol lector', () => {
    expect(capabilityRefusal('viewer', 'comment')).toContain('no permite comentar');
    expect(capabilityRefusal('commenter', 'comment')).toBeNull();
  });

  it('no explica nada cuando el rol todavía se desconoce', () => {
    expect(capabilityRefusal(null, 'edit')).toBeNull();
    expect(capabilityRefusal(null, 'manage')).toBeNull();
  });

  it('el aviso de solo lectura nombra el rol', () => {
    expect(readOnlyNotice('viewer')).toContain('lector');
    expect(readOnlyNotice('commenter')).toContain('comentarista');
  });

  it('los cuatro roles tienen etiqueta', () => {
    expect(Object.keys(ROLE_LABELS).sort()).toEqual(['commenter', 'editor', 'owner', 'viewer']);
  });
});

describe('roles · orden y parseo', () => {
  it('ordena owner > editor > commenter > viewer', () => {
    expect(roleRank('owner')).toBeGreaterThan(roleRank('editor'));
    expect(roleRank('editor')).toBeGreaterThan(roleRank('commenter'));
    expect(roleRank('commenter')).toBeGreaterThan(roleRank('viewer'));
    expect(roleRank(null)).toBe(0);
  });

  it('roleAtLeast respeta la jerarquía', () => {
    expect(roleAtLeast('editor', 'commenter')).toBe(true);
    expect(roleAtLeast('commenter', 'editor')).toBe(false);
    expect(roleAtLeast('owner', 'owner')).toBe(true);
    expect(roleAtLeast(null, 'viewer')).toBe(false);
  });

  it('parseRole acepta los cuatro y rechaza lo demás', () => {
    expect(parseRole('owner')).toBe('owner');
    expect(parseRole(' Viewer ')).toBe('viewer');
    expect(parseRole('admin')).toBeNull();
    expect(parseRole(3)).toBeNull();
    expect(parseRole(undefined)).toBeNull();
  });

  it('parseAssignableRole nunca devuelve owner', () => {
    expect(parseAssignableRole('owner')).toBeNull();
    expect(parseAssignableRole('editor')).toBe('editor');
  });
});

describe('roles · rechazo del socket', () => {
  it('un rechazo degrada owner/editor a lector', () => {
    expect(effectiveUiRole({ role: 'editor', socketRejected: true })).toBe('viewer');
    expect(effectiveUiRole({ role: 'owner', socketRejected: true })).toBe('viewer');
  });

  it('un rechazo sin rol conocido tampoco deja escribir', () => {
    expect(effectiveUiRole({ role: null, socketRejected: true })).toBe('viewer');
  });

  it('un comentarista rechazado sigue pudiendo comentar', () => {
    expect(effectiveUiRole({ role: 'commenter', socketRejected: true })).toBe('commenter');
  });

  it('sin rechazo manda el rol de la API', () => {
    expect(effectiveUiRole({ role: 'editor', socketRejected: false })).toBe('editor');
    expect(effectiveUiRole({ role: null, socketRejected: false })).toBeNull();
  });

  it('el solo lectura forzado (vista pública) siempre es lector', () => {
    expect(effectiveUiRole({ role: 'owner', socketRejected: false, forcedReadOnly: true })).toBe('viewer');
  });
});
