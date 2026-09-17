/**
 * Content script: extrae el título, la URL y la selección de la página.
 *
 * El popup le pide los datos con `chrome.tabs.sendMessage` y, si no hay
 * receptor (página abierta antes de instalar la extensión), inyecta este mismo
 * archivo con `chrome.scripting.executeScript({ files: ['content.js'] })`. Por
 * eso el registro es idempotente: `window.__tableroCaptureReady` evita que una
 * segunda inyección agregue otro oyente.
 *
 * Se compila como script clásico (Chrome no acepta módulos en content scripts),
 * así que no importa valores de otros módulos.
 */

interface PageData {
  title: string;
  url: string;
  selection: string;
}

interface Window {
  __tableroCaptureReady?: boolean;
}

function extractPageData(): PageData {
  let selection = '';
  try {
    selection = window.getSelection()?.toString() ?? '';
  } catch {
    selection = '';
  }
  return {
    title: document.title ?? '',
    url: window.location.href,
    selection: selection.trim(),
  };
}

if (!window.__tableroCaptureReady) {
  window.__tableroCaptureReady = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null) return undefined;
    if ((message as { type?: unknown }).type !== 'page-data') return undefined;
    sendResponse(extractPageData());
    return false;
  });
}
