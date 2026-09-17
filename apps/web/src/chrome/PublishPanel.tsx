/**
 * Panel de publicar (punto 2 de la fase 5).
 *
 * Publicar deja el tablero en `/p/:slug` en **solo lectura y sin sesión**
 * (decisión de la fase): slug inadvertible, contraseña opcional y subtableros
 * incluidos o no. Desde acá se publica, se copia el enlace, se abre la vista
 * pública y se deja de publicar.
 */

import { useEffect, useState } from 'react';

import { Copy, ExternalLink, Globe, GlobeLock, X } from 'lucide-react';

import { reportActivity } from '@/api/activity';
import { degradationMessage, isMissingEndpoint } from '@/api/degraded';
import { publishBoard, unpublishBoard, type Publication } from '@/api/sharing';
import { useSessionPermission } from '@/collab/SessionContext';
import { capabilityRefusal } from '@/collab/roles';
import { publicBoardUrl } from '@/lib/routes';
import { writeSystemText } from '@/lib/clipboard';
import { useAppStore } from '@/state/appStore';
import { usePanelsStore } from '@/state/panelsStore';

export function PublishPanel({ boardId }: { boardId: string }): JSX.Element | null {
  const open = usePanelsStore((state) => state.publishOpen);
  const setOpen = usePanelsStore((state) => state.setPublishOpen);
  const board = useAppStore((state) => state.boards.find((item) => item.id === boardId) ?? null);
  const setNotice = useAppStore((state) => state.setNotice);
  const permission = useSessionPermission();

  const [password, setPassword] = useState('');
  const [includeSubBoards, setIncludeSubBoards] = useState(true);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const publishedSlug = publication?.slug ?? board?.publishedSlug ?? null;
  const publishedAt = publication?.publishedAt ?? board?.publishedAt ?? null;
  const refusal = capabilityRefusal(permission.role, 'publish');

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return;
    }
    setIncludeSubBoards(publication?.includeSubBoards ?? true);
    setError(null);
  }, [open, publication?.includeSubBoards]);

  if (!open) return null;

  const url = publishedSlug ? publicBoardUrl(publishedSlug) : null;

  const publish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await publishBoard(boardId, {
        password: password.trim().length > 0 ? password.trim() : null,
        includeSubBoards,
      });
      setPublication(result);
      setPassword('');
      reportActivity(boardId, {
        action: 'board.publish',
        meta: { slug: result.slug, includeSubBoards, hasPassword: result.hasPassword },
      });
      setNotice(`Tablero publicado en /p/${result.slug} (solo lectura, sin sesión).`);
      void copy(publicBoardUrl(result.slug));
    } catch (cause) {
      setError(
        isMissingEndpoint(cause)
          ? 'La API todavía no expone la publicación de tableros.'
          : degradationMessage(cause, 'Publicar'),
      );
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await unpublishBoard(boardId);
      setPublication({ slug: '', url: null, includeSubBoards, hasPassword: false, publishedAt: null });
      reportActivity(boardId, { action: 'board.unpublish' });
      setNotice('El tablero dejó de estar publicado.');
    } catch (cause) {
      setError(degradationMessage(cause, 'Dejar de publicar'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string): Promise<void> => {
    if (value.length === 0) return;
    const ok = await writeSystemText(value);
    setCopied(ok);
    if (!ok) setNotice('El navegador no dejó copiar al portapapeles. Copia el enlace a mano.');
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal publish-panel"
        role="dialog"
        aria-label="Publicar el tablero"
        data-publish-panel
        data-publish-state={publishedSlug ? 'published' : 'draft'}
      >
        <header className="modal__head">
          <h2 className="modal__title">
            {publishedSlug ? <Globe size={15} /> : <GlobeLock size={15} />} Publicar «{board?.title ?? 'Tablero'}»
          </h2>
          <button type="button" className="icon-button" title="Cerrar" onClick={() => setOpen(false)}>
            <X size={14} />
          </button>
        </header>

        <div className="modal__body">
          {publishedSlug ? (
            <p className="publish-panel__banner" data-publish-banner>
              Este tablero está <strong>publicado</strong>
              {publishedAt ? ` desde ${new Date(publishedAt).toLocaleString('es')}` : ''}. Cualquiera con el
              enlace lo puede ver sin cuenta.
            </p>
          ) : (
            <p className="publish-panel__hint">
              La vista pública es de solo lectura y sin socket: se refresca cada 15 segundos.
            </p>
          )}

          {refusal ? (
            <p className="publish-panel__warning" data-publish-refusal>
              {refusal}
            </p>
          ) : null}
          {error ? (
            <p className="publish-panel__warning" data-publish-error>
              {error}
            </p>
          ) : null}

          <label className="publish-panel__field">
            <span>Enlace público</span>
            <input
              className="publish-panel__input"
              readOnly
              data-publish-slug
              value={publishedSlug ? url ?? `/p/${publishedSlug}` : 'Todavía no publicado'}
            />
          </label>

          <label className="publish-panel__field">
            <span>Contraseña (opcional)</span>
            <input
              className="publish-panel__input"
              type="password"
              placeholder={publishedSlug ? 'Dejá vacío para no cambiarla' : 'Sin contraseña'}
              data-publish-password
              value={password}
              disabled={!!refusal}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <label className="publish-panel__toggle">
            <input
              type="checkbox"
              data-publish-subboards
              checked={includeSubBoards}
              disabled={!!refusal}
              onChange={(event) => setIncludeSubBoards(event.target.checked)}
            />
            <span>Incluir los subtableros (navegables desde la vista pública)</span>
          </label>

          <div className="publish-panel__actions">
            <button
              type="button"
              className="publish-panel__primary"
              data-publish-submit
              disabled={busy || !!refusal}
              onClick={() => void publish()}
            >
              <Globe size={13} /> {publishedSlug ? 'Actualizar publicación' : 'Publicar'}
            </button>
            {publishedSlug && url ? (
              <>
                <button
                  type="button"
                  className="publish-panel__secondary"
                  data-publish-copy
                  onClick={() => void copy(url)}
                >
                  <Copy size={13} /> {copied ? 'Copiado' : 'Copiar enlace'}
                </button>
                <a
                  className="publish-panel__secondary"
                  data-publish-open
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} /> Abrir vista pública
                </a>
                <button
                  type="button"
                  className="publish-panel__danger"
                  data-publish-unpublish
                  disabled={busy}
                  onClick={() => void unpublish()}
                >
                  Dejar de publicar
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
