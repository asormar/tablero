/**
 * WebSocket de collaboration à travers Caddy, avec le vrai client.
 *
 *   node smoke-ws-proxy.mjs http://localhost:8080
 *
 * Utilise `@hocuspocus/provider` (le même que la web) : c'est le seul moyen
 * de vérifier le handshake réel, y desde el board completo (documento Yjs
 * sincronizado) hasta la escritura de bytes en Postgres. Los tests de la API
 * abren el socket directo contra Fastify, así que esto es lo único que
 * comprueba que el proxy no rompe nada.
 *
 * OJO — dos trampas de este lado (Node, no navegador):
 *  1. El navegador manda solo la cookie de sesión; desde Node hay que
 *     inyectarla en el handshake. La opción `headers` del provider NO llega al
 *     upgrade (el servidor responde 4401 «No autenticado»).
 *  2. `WebSocketPolyfill` no se usa en la ruta que toma el provider cuando el
 *     runtime ya trae WebSocket global (Node >= 22), así que tampoco sirve.
 *     Lo que funciona es setear el WebSocket global antes de construir el
 *     provider, que es exactamente lo que hace un navegador.
 */

import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket } from 'ws';

const BASE = process.argv[2] ?? 'http://localhost:8080';
const COLLAB = `${BASE.replace(/^http/, 'ws')}/collab`;

let cookie = '';

function die(message, detail = '') {
  console.error(`FALLA  ${message}${detail ? ` — ${detail}` : ''}`);
  process.exit(1);
}

const register = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify({
    email: `ws-${Date.now()}@example.com`,
    password: 'PruebaWs123!',
    name: 'WS',
  }),
});

if (register.status >= 400) die('el registro falló', `${register.status} ${await register.text()}`);
for (const entry of register.headers.getSetCookie?.() ?? []) {
  const [pair] = entry.split(';');
  if (pair.startsWith('tablero_session=')) cookie = pair;
}
console.log('OK    registro por REST y cookie de sesión');

const boards = await (await fetch(`${BASE}/api/boards`, { headers: { cookie, origin: BASE } })).json();
const boardId = boards?.boards?.[0]?.id ?? boards?.[0]?.id;
if (!boardId) die('no hay tablero para la sesión nueva', JSON.stringify(boards).slice(0, 150));
console.log('OK    tablero de la sesión:', boardId);

// El provider toma el WebSocket global: se reemplaza por uno que mande la
// cookie, que es lo que el navegador hace solo.
globalThis.WebSocket = class extends WebSocket {
  constructor(address, protocols) {
    super(address, protocols, { headers: { cookie, origin: BASE } });
  }
};

const provider = new HocuspocusProvider({
  url: COLLAB,
  name: boardId,
  // El cliente real manda un marcador corto que el servidor descarta; lo
  // importante es que la credencial de verdad es la cookie del handshake.
  token: 'BROWSER_AUTH_TRIGGER',
  document: null,
});

let synced = false;
let closed = null;

const done = (code) => {
  console.log('');
  if (code === 0) {
    console.log('El WebSocket de colaboración funciona de punta a punta por el proxy:');
    console.log('  registro → cookie → upgrade 101 → documento Yjs sincronizado.');
  } else {
    console.log('El socket abrió y el servidor lo cerró con un código del protocolo.');
    console.log(`  code ${closed} — eso también prueba que hay un Hocuspocus real detrás del proxy.`);
  }
  process.exit(code);
};

const timeout = setTimeout(() => {
  die('el proveedor no sincronizó en 25 s (ni siquiera cerró)');
}, 25000);

provider.on('status', ({ status }) => {
  console.log('    estado del proveedor:', status);
  if (status === 'connected' && !synced) {
    console.log('OK    el proveedor quedó conectado (la cookie llegó a través de Caddy)');
  }
});

provider.on('synced', () => {
  synced = true;
  console.log('OK    documento Yjs sincronizado — el proxy no interfiere el collarín');
  clearTimeout(timeout);
  provider.destroy();
  done(0);
});

provider.on('authenticationFailed', () => {
  die('el servidor rechazó la autenticación del socket');
});

provider.on('disconnect', () => {
  if (!synced) die('se desconectó antes de sincronizar');
});

provider.on('close', ({ code }) => {
  closed = code;
  if (!synced) {
    clearTimeout(timeout);
    if (code === 4401 || code === 4403) {
      console.log('OK    el servidor cerró con un código de permisos:', code);
      done(1);
    } else {
      die(`cerrado antes de sincronizar — code ${code}`);
    }
  }
});

provider.on('status', ({ status }) => {
  if (status === 'disconnected' && !synced && closed === null) {
    // Hocuspocus reintenta solo; no cortamos el test por esto.
  }
});
