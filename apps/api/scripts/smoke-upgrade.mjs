/**
 * Humo del upgrade del WebSocket.
 *
 * Comprueba dos cosas que ya nos costaron un apagado del servidor:
 *  1. Un upgrade con `Origin` no permitido (o ausente) y cookie de sesión se
 *     rechaza con 403.
 *  2. El API **sigue vivo** después del rechazo, incluso si el cliente corta la
 *     conexión de golpe (ECONNRESET) y aunque se repita en ráfaga.
 *
 * Uso:  API_URL=http://localhost:8787 node scripts/smoke-upgrade.mjs
 * Requiere una instancia del API corriendo.
 */
import WebSocket from 'ws';

const base = process.env.API_URL ?? 'http://localhost:8787';
const wsBase = base.replace(/^http/, 'ws');
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173';

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '  OK  ' : ' FALLA'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
};

/** Abre un WebSocket y espera el veredicto: aceptado, rechazado o error. */
function probeWebSocket({ cookie, origin: requestOrigin, timeoutMs = 5000 }) {
  return new Promise((resolve) => {
    const headers = {};
    if (requestOrigin !== undefined) headers.Origin = requestOrigin;
    if (cookie) headers.Cookie = cookie;
    const ws = new WebSocket(`${wsBase}/collab`, { headers });
    const done = (result) => {
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        /* ya estaba cerrado */
      }
      resolve(result);
    };
    const timer = setTimeout(() => done({ status: 'timeout' }), timeoutMs);
    ws.on('unexpected-response', (_req, res) => done({ status: 'rejected', code: res.statusCode }));
    ws.on('open', () => done({ status: 'open' }));
    ws.on('error', (error) => done({ status: 'error', message: error.message }));
  });
}

async function alive() {
  try {
    const res = await fetch(`${base}/api/health`);
    return res.status;
  } catch (error) {
    return `sin respuesta (${error.message})`;
  }
}

async function main() {
  console.log(`Humo del upgrade del WebSocket contra ${base}`);

  const email = `upgrade.${Date.now()}@tablero.local`;
  const registro = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, name: 'Humo Upgrade', password: 'humo-upgrade-2026' }),
  });
  if (!registro.ok) {
    console.log(`No se pudo registrar el usuario de prueba (${registro.status}). ¿Está el API arriba?`);
    process.exit(1);
  }
  const cookie = (registro.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ');
  check('registro con cookie de sesión', cookie.includes('tablero_session='));

  const ajeno = await probeWebSocket({ cookie, origin: 'http://evil.example' });
  check('Origin ajeno + cookie → rechazado con 403', ajeno.status === 'rejected' && ajeno.code === 403, `estado: ${ajeno.status} ${ajeno.code ?? ''}`);
  check('el API sigue vivo después del rechazo', (await alive()) === 200);

  const sinOrigin = await probeWebSocket({ cookie, origin: undefined });
  check('sin Origin + cookie → rechazado con 403', sinOrigin.status === 'rejected' && sinOrigin.code === 403, `estado: ${sinOrigin.status} ${sinOrigin.code ?? ''}`);
  check('el API sigue vivo después', (await alive()) === 200);

  const propio = await probeWebSocket({ cookie, origin });
  check('Origin permitido + cookie → conexión aceptada', propio.status === 'open', `estado: ${propio.status} ${propio.message ?? ''}`);
  check('el API sigue vivo con una sesión abierta', (await alive()) === 200);

  for (let i = 0; i < 5; i += 1) await probeWebSocket({ cookie, origin: 'http://evil.example' });
  check('el API sigue vivo tras una ráfaga de 5 rechazos', (await alive()) === 200);

  const sinCookie = await probeWebSocket({ origin: 'http://evil.example' });
  check('sin cookie no se bloquea por Origin (lo corta onAuthenticate)', sinCookie.status === 'open' || sinCookie.status === 'error' || sinCookie.status === 'timeout', `estado: ${sinCookie.status}`);

  console.log(failures === 0 ? '\nTodo en verde.' : `\n${failures} comprobaciones fallidas.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Humo del upgrade interrumpido:', error);
  process.exit(1);
});
