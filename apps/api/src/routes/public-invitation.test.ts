/**
 * La vista de una invitación es **pública** (arreglo de la revisión de la fase 5).
 *
 * El contrato dice que el token del enlace es la credencial, así que la ruta no
 * puede quedar dentro del scope con sesión: este test usa el **registro real**
 * (`buildApp` → `routes/index.ts`), no un plugin suelto, para que la garantía no
 * dependa de cómo la monte cada test de rutas.
 */

import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  invitations: new Map<string, Record<string, unknown>>(),
  boards: new Map<string, Record<string, unknown>>(),
  users: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../db.js', () => ({
  prisma: {
    invitation: {
      findUnique: async ({ where }: { where: { token: string } }) => {
        const row = db.invitations.get(where.token);
        if (!row) return null;
        return {
          ...row,
          board: db.boards.get(String(row.boardId)) ?? null,
          invitedBy: db.users.get(String(row.invitedById)) ?? null,
        };
      },
    },
  },
}));

// El logger del servidor real se silencia antes de importar `app.ts`.
process.env.LOG_LEVEL = 'silent';

const { buildApp } = await import('../app.js');

const TOKEN = 'tok-publico-de-prueba-123456';

function seedInvitation(): void {
  db.users.set('user_ana', { id: 'user_ana', name: 'Ana' });
  db.boards.set('proyecto', { id: 'proyecto', title: 'Proyecto', icon: '📌' });
  db.invitations.set(TOKEN, {
    id: 'inv_1',
    boardId: 'proyecto',
    email: 'nueva@tablero.test',
    role: 'viewer',
    token: TOKEN,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    acceptedAt: null,
    acceptedById: null,
    invitedById: 'user_ana',
    createdAt: new Date(),
  });
}

describe('GET /api/invitations/:token (registro real)', () => {
  it('se ve sin sesión: el token es la credencial', async () => {
    seedInvitation();
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: `/api/invitations/${TOKEN}` });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      invitation: { email: string; emailMatches: boolean; role: string };
      board: { id: string; title: string };
    };
    // Sin sesión, el email va enmascarado; el tablero viaja en el nivel superior.
    expect(body.invitation.email).toBe('n****@tablero.test');
    expect(body.invitation.emailMatches).toBe(false);
    expect(body.invitation.role).toBe('viewer');
    expect(body.board).toMatchObject({ id: 'proyecto', title: 'Proyecto' });
    await app.close();
  });

  it('un token inexistente responde 404 sin sesión (sin filtrar nada)', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/invitations/tok-que-no-existe-123456' });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('invitation_not_found');
    await app.close();
  });

  it('el resto del API sigue exigiendo sesión (401 sin cookie)', async () => {
    const app = await buildApp();
    const protectedRoute = await app.inject({ method: 'GET', url: '/api/boards/proyecto/members' });
    expect(protectedRoute.statusCode).toBe(401);
    await app.close();
  });
});
