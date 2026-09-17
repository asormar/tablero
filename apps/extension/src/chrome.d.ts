/**
 * Tipos mínimos de las APIs de Chrome que usa la extensión.
 *
 * Se declaran a mano (en lugar de `@types/chrome`) para que el paquete no tenga
 * dependencias: solo se cubre lo que se usa, que es poco y estable. Las firmas
 * son las de la API basada en promesas (MV3, Chrome 99+).
 */

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      id?: string;
      url?: string;
      tab?: { id?: number; url?: string; title?: string };
    }

    interface OnMessageEvent {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | undefined | void,
      ): void;
    }

    interface InstalledEvent {
      addListener(listener: (details: { reason: string }) => void): void;
    }

    const onMessage: OnMessageEvent;
    const onInstalled: InstalledEvent;
    const lastError: { message?: string } | undefined;

    function sendMessage(message: unknown): Promise<unknown>;
    function getURL(path: string): string;
  }

  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }

    const local: StorageArea;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId?: number;
      url?: string;
      title?: string;
      active?: boolean;
    }

    interface QueryInfo {
      active?: boolean;
      currentWindow?: boolean;
      lastFocusedWindow?: boolean;
    }

    function query(queryInfo: QueryInfo): Promise<Tab[]>;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
    function captureVisibleTab(
      windowId?: number,
      options?: { format?: 'png' | 'jpeg'; quality?: number },
    ): Promise<string>;
  }

  namespace scripting {
    interface InjectionTarget {
      tabId: number;
      allFrames?: boolean;
    }

    interface ScriptInjection {
      target: InjectionTarget;
      files?: string[];
      func?: (...args: never[]) => unknown;
      args?: unknown[];
    }

    interface InjectionResult {
      frameId: number;
      result?: unknown;
    }

    function executeScript(injection: ScriptInjection): Promise<InjectionResult[]>;
  }
}
