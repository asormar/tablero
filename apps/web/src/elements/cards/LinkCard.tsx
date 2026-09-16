/**
 * Tarjeta de enlace.
 *
 * Al pegar una URL, `detectEmbed` decide al instante si hay incrustado
 * reproducible (YouTube, Vimeo, Spotify, X, Maps, Figma, Loom, CodePen): el
 * reproductor aparece de inmediato y los metadatos (título, descripción,
 * imagen, favicon) llegan después de `GET /api/link-preview`. Sin API, la
 * tarjeta se queda con el incrustado y el dominio, que es información
 * suficiente para trabajar.
 */

import { useEffect, useMemo, useState } from 'react';

import { ExternalLink, Globe, ImageOff, Pencil, X } from 'lucide-react';

import {
  type LinkEmbedType,
  type LinkPreviewData,
  detectEmbed,
  displayDomain,
  embedHeight,
  isEmbeddable,
} from '@tablero/shared';

import { fetchLinkPreview } from '@/api/assets';
import {
  type LinkDisplaySize,
  LINK_DISPLAY_SIZES,
  instantLinkPreview,
  setLinkDisplaySize,
  setLinkTitle,
  updateLinkElement,
} from '@/canvas/contentCommands';
import type { BoardSession } from '@/collab/BoardSession';
import { InlineEdit } from '@/elements/InlineEdit';
import { embedLabel } from '@/lib/pasteTargets';

import type { CardProps } from './AssetCards';

/** Permisos que necesitan los incrustados habituales (vídeo y audio). */
const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share';

const IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox';

export function LinkCard({ session, element, simplified }: CardProps): JSX.Element {
  const url = element.type === 'link' ? element.url : '';
  const preview = element.type === 'link' ? element.preview ?? null : null;
  const displaySize: LinkDisplaySize = element.type === 'link' ? element.displaySize ?? 'medium' : 'medium';
  const [editing, setEditing] = useState(url.length === 0);
  const [urlDraft, setUrlDraft] = useState(url);

  const detected = useMemo(() => detectEmbed(url), [url]);
  const embedType: LinkEmbedType =
    preview && preview.embedType !== 'generic' ? preview.embedType : detected.embedType;
  const embedUrl = (preview?.embedUrl && preview.embedUrl.length > 0 ? preview.embedUrl : detected.embedUrl) ?? null;
  const embeddable = embedUrl !== null && isEmbeddable(embedType);
  const height = embeddable ? embedHeight(embedType, element.width) : 0;

  // Una previsualización con `fetchedAt > 0` viene de la API; la inmediata
  // (`fetchedAt: 0`) solo aporta el incrustado y hay que completarla.
  const hasFreshPreview = preview !== null && preview.url === url && preview.fetchedAt > 0;
  // El incrustado se publica en cuanto se conoce la URL, sin esperar a la API.
  useEffect(() => {
    if (url.length === 0) return;
    if (preview === null) {
      updateLinkElement(session, element.id, {
        preview: instantLinkPreview({ url, embedType: detected.embedType, embedUrl: detected.embedUrl }),
      });
    }
  }, [url, preview, session, element.id, detected.embedType, detected.embedUrl]);

  useEffect(() => {
    if (url.length === 0 || hasFreshPreview) return undefined;
    let cancelled = false;
    void fetchLinkPreview(url).then((data) => {
      if (cancelled || !data) return;
      const merged: LinkPreviewData = {
        ...data,
        // La URL del elemento manda: evita que una redirección reescriba el campo.
        url,
        embedType: data.embedType && data.embedType !== 'generic' ? data.embedType : detected.embedType,
        embedUrl: data.embedUrl ?? detected.embedUrl,
      };
      updateLinkElement(session, element.id, { preview: merged });
    });
    return () => {
      cancelled = true;
    };
  }, [url, hasFreshPreview, session, element.id, detected.embedType, detected.embedUrl]);

  useEffect(() => {
    setUrlDraft(url);
  }, [url]);

  const domain = displayDomain(url);
  const title = preview?.title ?? (domain.length > 0 ? domain : 'Enlace');
  const description = preview?.description ?? '';
  const image = preview?.imageUrl ?? null;

  const applyUrl = (): void => {
    const next = urlDraft.trim();
    if (next.length === 0 || next === url) {
      setEditing(false);
      return;
    }
    const normalized = /^www\./i.test(next) ? `https://${next}` : next;
    const embed = detectEmbed(normalized);
    updateLinkElement(session, element.id, {
      url: normalized,
      preview: instantLinkPreview({ url: normalized, embedType: embed.embedType, embedUrl: embed.embedUrl }),
    });
    setEditing(false);
  };

  if (url.length === 0) {
    return (
      <div className="link-card link-card--empty">
        <span className="link-card__empty-icon">
          <Globe size={16} />
        </span>
        <input
          className="link-card__url-input"
          type="url"
          placeholder="Pega un enlace (https://…)"
          aria-label="URL del enlace"
          value={urlDraft}
          autoFocus
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') applyUrl();
            if (event.key === 'Escape') setEditing(false);
          }}
          onChange={(event) => setUrlDraft(event.target.value)}
          onBlur={applyUrl}
        />
      </div>
    );
  }

  const showEmbed = embeddable && displaySize !== 'compact' && !simplified;
  const showImage = !showEmbed && image !== null && displaySize !== 'compact';

  return (
    <div className={`link-card link-card--${displaySize}`} data-embed={embedType}>
      {showEmbed && embedUrl ? (
        <div className="link-card__embed" style={{ height }}>
          <iframe
            src={embedUrl}
            title={title}
            width="100%"
            height={height}
            sandbox={IFRAME_SANDBOX}
            allow={IFRAME_ALLOW}
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            onPointerDown={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}

      {showImage ? (
        <a
          className="link-card__thumb"
          href={url}
          target="_blank"
          rel="noreferrer"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <img src={image} alt="" loading="lazy" draggable={false} />
        </a>
      ) : null}

      <div className="link-card__body">
        <div className="link-card__headline">
          {preview?.faviconUrl ? (
            <img className="link-card__favicon" src={preview.faviconUrl} alt="" loading="lazy" />
          ) : (
            <span className="link-card__favicon link-card__favicon--empty">
              <Globe size={11} />
            </span>
          )}
          <a
            className="link-card__title"
            href={url}
            target="_blank"
            rel="noreferrer"
            title={title}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {title}
          </a>
        </div>
        {displaySize === 'large' && description.length > 0 ? (
          <p className="link-card__description">{description}</p>
        ) : null}
        {!simplified ? (
          <div className="link-card__footer">
            <span className="link-card__domain">{domain}</span>
            {!hasFreshPreview ? (
              <span className="link-card__loading" title="Buscando metadatos…">
                …
              </span>
            ) : null}
            {embeddable && !showEmbed ? <span className="link-card__badge">{embedLabel(embedType)}</span> : null}
          </div>
        ) : null}
      </div>

      {editing && !simplified ? (
        <div className="link-card__editor" onPointerDown={(event) => event.stopPropagation()}>
          <label className="link-card__field">
            <span>URL</span>
            <input
              type="url"
              value={urlDraft}
              aria-label="URL del enlace"
              onChange={(event) => setUrlDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') applyUrl();
                if (event.key === 'Escape') {
                  setUrlDraft(url);
                  setEditing(false);
                }
              }}
            />
          </label>
          <label className="link-card__field">
            <span>Título</span>
            <InlineEdit
              value={preview?.title ?? ''}
              placeholder={domain || 'Título del enlace'}
              ariaLabel="Título del enlace"
              onCommit={(next) => setLinkTitle(session, element.id, next)}
            />
          </label>
          <div className="link-card__sizes" role="group" aria-label="Tamaño de la tarjeta">
            {(Object.keys(LINK_DISPLAY_SIZES) as LinkDisplaySize[]).map((size) => (
              <button
                key={size}
                type="button"
                className={size === displaySize ? 'is-active' : undefined}
                onClick={() => setLinkDisplaySize(session, element.id, size)}
              >
                {LINK_DISPLAY_SIZES[size].label}
              </button>
            ))}
          </div>
          <div className="link-card__editor-actions">
            <button type="button" onClick={applyUrl}>
              Aplicar
            </button>
            <button
              type="button"
              onClick={() => {
                setUrlDraft(url);
                setEditing(false);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {!simplified ? (
        <div className="card-tools" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            title={editing ? 'Cerrar edición' : 'Editar URL y título'}
            className={editing ? 'is-active' : undefined}
            onClick={() => setEditing((open) => !open)}
          >
            {editing ? <X size={13} /> : <Pencil size={13} />}
          </button>
          <a
            className="card-tools__link"
            title="Abrir en una pestaña nueva"
            href={url}
            target="_blank"
            rel="noreferrer"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <ExternalLink size={13} />
          </a>
          {image === null && embeddable ? (
            <span className="card-tools__hint">
              <ImageOff size={11} />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

