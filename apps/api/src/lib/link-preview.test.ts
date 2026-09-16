/**
 * Guardas anti-SSRF de `fetchLinkPreview`: normalización de hosts, validación
 * de TODAS las direcciones del DNS y conexión a la IP ya validada (sin volver
 * a resolver, así un DNS rebind no puede colar una dirección privada).
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupFunction } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { HttpError } from '../lib/errors.js';
import {
  fetchLinkPreview,
  httpTransport,
  isPublicAddress,
  pinnedLookup,
  type LinkPreviewLookup,
  type LinkPreviewTransport,
} from './link-preview.js';

const PUBLIC_IP: { address: string; family: number } = { address: '93.184.216.34', family: 4 };
const REBIND_IP = { address: '127.0.0.1', family: 4 };

const HTML = `<!doctype html>
<html><head>
  <title>Ejemplo</title>
  <meta property="og:title" content="Título OG" />
  <meta property="og:description" content="Descripción OG" />
  <meta property="og:image" content="/imagen.png" />
  <link rel="icon" href="/favicon.png" />
</head><body>ok</body></html>`;

/** Transporte doble: devuelve el HTML dado y registra a qué IP se lo pidieron. */
function fakeTransport(
  response: Partial<Awaited<ReturnType<LinkPreviewTransport>>> = {},
  seen: { urls: string[]; addresses: string[] } = { urls: [], addresses: [] },
): LinkPreviewTransport {
  return async (url, address) => {
    seen.urls.push(url.toString());
    seen.addresses.push(address.address);
    return { status: 200, location: null, contentType: 'text/html; charset=utf-8', body: HTML, ...response };
  };
}

async function expectForbidden(url: string): Promise<void> {
  const seen = { urls: [] as string[], addresses: [] as string[] };
  await expect(fetchLinkPreview(url, { transport: fakeTransport({}, seen) })).rejects.toMatchObject({
    code: 'link_preview_forbidden_host',
  });
  // Nada salió a la red: el host se rechaza antes de pedir.
  expect(seen.urls).toEqual([]);
}

/** Pregunta a un `lookup` como lo hace el socket (con `all: true`). */
function askLookup(lookup: LookupFunction, hostname: string): Promise<string> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (error, address) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Array.isArray(address) ? address[0]!.address : address);
    });
  });
}

describe('rechazo de hosts privados o no canónicos', () => {
  const forbidden = [
    'http://127.0.0.1/',
    'http://127.1/', // forma corta de 127.0.0.1
    'http://2130706433/', // 127.0.0.1 como entero
    'http://0x7f.0.0.1/', // hex
    'http://0177.0.0.1/', // octal
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', // IPv4-mapped
    'http://[::7f00:1]/', // rango obsoleto ::/96
    'http://[fe80::1]/', // link-local
    'http://[fc00::1]/', // ULA
    'http://169.254.169.254/latest/meta-data/', // metadatos de la nube
    'http://10.1.2.3/',
    'http://172.16.0.1/',
    'http://192.168.0.1/',
    'http://100.64.0.1/', // carrier-grade NAT
    'http://localhost/',
    'http://localhost:8787/api/health',
    'http://algo.localhost/',
    'http://tablero.local/',
  ];

  for (const url of forbidden) {
    it(`rechaza ${url}`, async () => {
      await expectForbidden(url);
    });
  }

  it('rechaza un dominio público que resuelve a una dirección privada', async () => {
    const lookup: LinkPreviewLookup = async () => [{ address: '10.0.0.5', family: 4 }];
    await expect(fetchLinkPreview('https://interno.example/', { lookup, transport: fakeTransport() })).rejects.toMatchObject(
      { code: 'link_preview_forbidden_host' },
    );
  });

  it('rechaza el host si CUALQUIERA de sus direcciones es privada', async () => {
    const lookup: LinkPreviewLookup = async () => [PUBLIC_IP, { address: '192.168.1.10', family: 4 }];
    await expect(fetchLinkPreview('https://mixto.example/', { lookup, transport: fakeTransport() })).rejects.toMatchObject({
      code: 'link_preview_forbidden_host',
    });
  });

  it('isPublicAddress clasifica rangos especiales y públicos', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2001:4860:4860::8888')).toBe(true);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true); // mapped público
    expect(isPublicAddress('127.0.0.1')).toBe(false);
    expect(isPublicAddress('2130706433')).toBe(false);
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('240.0.0.1')).toBe(false);
    expect(isPublicAddress('no-es-una-ip')).toBe(false);
  });
});

describe('hosts públicos', () => {
  it('acepta un dominio público y usa la IP validada', async () => {
    const seen = { urls: [] as string[], addresses: [] as string[] };
    const lookupCalls: string[] = [];
    const lookup: LinkPreviewLookup = async (hostname) => {
      lookupCalls.push(hostname);
      return [PUBLIC_IP];
    };

    const preview = await fetchLinkPreview('https://example.com/pagina', { lookup, transport: fakeTransport({}, seen) });

    expect(lookupCalls).toEqual(['example.com']);
    expect(seen.addresses).toEqual([PUBLIC_IP.address]);
    expect(seen.urls).toEqual(['https://example.com/pagina']);
    expect(preview.title).toBe('Título OG');
    expect(preview.description).toBe('Descripción OG');
    expect(preview.imageUrl).toBe('https://example.com/imagen.png');
    expect(preview.faviconUrl).toBe('https://example.com/favicon.png');
    expect(preview.url).toBe('https://example.com/pagina');
  });

  it('acepta una IP pública como host sin consultar el DNS', async () => {
    let lookupCalled = false;
    const lookup: LinkPreviewLookup = async () => {
      lookupCalled = true;
      return [PUBLIC_IP];
    };
    const seen = { urls: [] as string[], addresses: [] as string[] };

    const preview = await fetchLinkPreview('http://93.184.216.34/', { lookup, transport: fakeTransport({}, seen) });

    expect(lookupCalled).toBe(false);
    expect(seen.addresses).toEqual(['93.184.216.34']);
    expect(preview.title).toBe('Título OG');
  });

  it('revalida cada salto de una redirección', async () => {
    const lookupCalls: string[] = [];
    const lookup: LinkPreviewLookup = async (hostname) => {
      lookupCalls.push(hostname);
      return [PUBLIC_IP];
    };
    const seen = { urls: [] as string[], addresses: [] as string[] };
    const transport = fakeTransport({}, seen);
    const redirecting: LinkPreviewTransport = async (url, address) => {
      if (url.hostname === 'origen.example') {
        seen.urls.push(url.toString());
        seen.addresses.push(address.address);
        return { status: 302, location: 'https://destino.example/final', contentType: null, body: '' };
      }
      return transport(url, address);
    };

    const preview = await fetchLinkPreview('https://origen.example/', { lookup, transport: redirecting });

    expect(lookupCalls).toEqual(['origen.example', 'destino.example']);
    expect(seen.addresses).toEqual([PUBLIC_IP.address, PUBLIC_IP.address]);
    expect(preview.url).toBe('https://destino.example/final');
  });

  it('rechaza una redirección hacia un host privado', async () => {
    const seen = { urls: [] as string[], addresses: [] as string[] };
    const transport: LinkPreviewTransport = async (url, address) => {
      seen.urls.push(url.toString());
      seen.addresses.push(address.address);
      return { status: 302, location: 'http://169.254.169.254/latest/meta-data/', contentType: null, body: '' };
    };

    await expect(fetchLinkPreview('https://origen.example/', { lookup: async () => [PUBLIC_IP], transport })).rejects.toMatchObject(
      { code: 'link_preview_forbidden_host' },
    );
    // Solo se pidió el primer salto: el destino privado nunca se descarga.
    expect(seen.urls).toEqual(['https://origen.example/']);
  });

  it('mantiene los errores de respuesta (no HTML, HTTP y demasiadas redirecciones)', async () => {
    const lookup: LinkPreviewLookup = async () => [PUBLIC_IP];
    await expect(
      fetchLinkPreview('https://example.com/', {
        lookup,
        transport: fakeTransport({ contentType: 'application/json', body: '{}' }),
      }),
    ).rejects.toMatchObject({ code: 'link_preview_not_html' });
    await expect(
      fetchLinkPreview('https://example.com/', { lookup, transport: fakeTransport({ status: 500 }) }),
    ).rejects.toMatchObject({ code: 'link_preview_http_error' });
    await expect(
      fetchLinkPreview('https://example.com/', {
        lookup,
        transport: fakeTransport({ status: 301, location: 'https://example.com/', body: '' }),
      }),
    ).rejects.toMatchObject({ code: 'link_preview_too_many_redirects' });
  });
});

describe('TOCTOU del DNS (rebind entre la validación y el pedido)', () => {
  it('resuelve una sola vez y conecta a la IP validada, nunca a la del rebind', async () => {
    const lookupCalls: string[] = [];
    // Doble que cambia de respuesta: pública en la primera consulta, loopback
    // en cualquier consulta posterior (el rebind).
    const rebindingLookup: LinkPreviewLookup = async (hostname) => {
      lookupCalls.push(hostname);
      return lookupCalls.length === 1 ? [PUBLIC_IP] : [REBIND_IP];
    };

    let connectedTo: string | null = null;
    const socketAnswers: string[] = [];
    const transport: LinkPreviewTransport = async (_url, address) => {
      connectedTo = address.address;
      // Igual que el transporte real: el `lookup` del socket solo puede
      // devolver la IP ya validada, por más que el DNS ya haya cambiado.
      const pinned = pinnedLookup(address);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        socketAnswers.push(await askLookup(pinned, 'example.com'));
      }
      return { status: 200, location: null, contentType: 'text/html', body: HTML };
    };

    const preview = await fetchLinkPreview('https://example.com/', { lookup: rebindingLookup, transport });

    expect(lookupCalls).toEqual(['example.com']); // una sola consulta de DNS
    expect(connectedTo).toBe(PUBLIC_IP.address); // la conexión usa la IP validada
    expect(socketAnswers).toEqual([PUBLIC_IP.address, PUBLIC_IP.address, PUBLIC_IP.address]);
    expect(socketAnswers).not.toContain(REBIND_IP.address); // nunca la del rebind
    expect(preview.title).toBe('Título OG');
  });

  it('pinnedLookup responde la forma con y sin `all` (nunca consulta el DNS)', async () => {
    const pinned = pinnedLookup(PUBLIC_IP);
    // Forma con `all: true` (la que usa el socket cuando autoSelectFamily está activo).
    expect(await askLookup(pinned, 'example.com')).toBe(PUBLIC_IP.address);
    expect(await askLookup(pinned, 'otro.example')).toBe(PUBLIC_IP.address);
    // Forma con familia explícita.
    const single = await new Promise<string>((resolve, reject) => {
      pinned('example.com', { family: 4 }, (error, address) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Array.isArray(address) ? address[0]!.address : address);
      });
    });
    expect(single).toBe(PUBLIC_IP.address);
  });
});

describe('transporte real (conexión a la IP fijada)', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  });

  it('conecta a la dirección indicada y conserva el Host original', async () => {
    let hostHeader: string | undefined;
    const requests: string[] = [];
    server = createServer((request, response) => {
      requests.push(request.url ?? '');
      hostHeader = request.headers.host;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(HTML);
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    // El transporte no valida (eso ya pasó en `resolvePublicAddress`): acá se
    // comprueba que la petición sale hacia la IP fijada y devuelve el cuerpo.
    const url = new URL(`http://127.0.0.1:${port}/pagina`);
    const response = await httpTransport(url, { address: '127.0.0.1', family: 4 });

    expect(response.status).toBe(200);
    expect(response.contentType).toContain('text/html');
    expect(response.body).toContain('Título OG');
    expect(requests).toEqual(['/pagina']);
    expect(hostHeader).toBe(`127.0.0.1:${port}`);
  });

  it('corta el cuerpo a 512 KB', async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.write('<html><body>');
      response.write('x'.repeat(700 * 1024));
      response.end('</body></html>');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const response = await httpTransport(new URL(`http://127.0.0.1:${port}/grande`), {
      address: '127.0.0.1',
      family: 4,
    });

    expect(response.status).toBe(200);
    expect(response.body.length).toBeLessThanOrEqual(512 * 1024);
  });

  it('propaga la redirección sin seguirla (la sigue fetchHtml)', async () => {
    server = createServer((_request, response) => {
      response.writeHead(302, { location: 'https://example.com/otra' });
      response.end();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const response = await httpTransport(new URL(`http://127.0.0.1:${port}/salta`), {
      address: '127.0.0.1',
      family: 4,
    });

    expect(response.status).toBe(302);
    expect(response.location).toBe('https://example.com/otra');
  });
});

describe('errores HTTP tipados', () => {
  it('un fallo de DNS es 400 (no una excepción suelta)', async () => {
    const lookup: LinkPreviewLookup = async () => {
      throw new Error('ENOTFOUND');
    };
    const error = await fetchLinkPreview('https://no-existe.example/', { lookup, transport: fakeTransport() }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 400, code: 'link_preview_dns_error' });
  });
});
