import { IGalleryContent, IGalleryItem } from '../../types/matrix/common';
import { sanitizeText } from './sanitize';

const unescapeHtml = (html: string): string =>
  html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

export const getGalleryItems = (content: IGalleryContent): IGalleryItem[] =>
  Array.isArray(content.itemtypes) ? content.itemtypes : [];

/**
 * Text listing the gallery items, so clients without MSC4274 support
 * still show that the message contains media.
 */
const getGalleryFallbackLines = (items: IGalleryItem[]): string[] =>
  items.map((item) => `[${item.itemtype}: ${item.filename ?? item.body ?? 'file'}]`);

export const getGalleryBody = (items: IGalleryItem[], caption?: string): string =>
  [...(caption ? [caption] : []), ...getGalleryFallbackLines(items)].join('\n');

export const getGalleryFormattedBody = (items: IGalleryItem[], formattedCaption: string): string =>
  [formattedCaption, ...getGalleryFallbackLines(items).map(sanitizeText)].join('<br>');

const getGalleryItemNames = (items: IGalleryItem[]): string[] =>
  items
    .flatMap((item) => [item.filename, item.body])
    .filter((name): name is string => typeof name === 'string' && name.length > 0);

// A fallback line is wrapped in [] and mentions one of the item file names.
// This also matches fallbacks sent by other clients, e.g. Sable's `[name.jpg: mxc://…]`.
const isFallbackLine = (line: string, names: string[]): boolean => {
  const text = line.trim();
  return text.startsWith('[') && text.endsWith(']') && names.some((name) => text.includes(name));
};

const stripFallbackFromBody = (body: string, names: string[]): string =>
  body
    .split('\n')
    .filter((line) => !isFallbackLine(line, names))
    .join('\n')
    .trim();

const stripFallbackFromFormattedBody = (html: string, names: string[]): string => {
  // Keep the separators so the remaining markup stays untouched.
  const parts = html.split(/(<br\s*\/?>|\n)/i);
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (!isFallbackLine(unescapeHtml(parts[i]), names)) {
      if (kept.length > 0) kept.push(parts[i - 1]);
      kept.push(parts[i]);
    }
  }
  return kept.join('').replace(/^(\s|<br\s*\/?>)+|(\s|<br\s*\/?>)+$/gi, '');
};

/**
 * MSC4274 uses body as the gallery caption.
 * Returns the content with item fallback lines removed, or undefined when there is no caption.
 */
export const getGalleryCaptionContent = (content: IGalleryContent): IGalleryContent | undefined => {
  const names = getGalleryItemNames(getGalleryItems(content));
  const body = stripFallbackFromBody(content.body ?? '', names);
  if (!body) return undefined;

  const formattedBody =
    content.format === 'org.matrix.custom.html' && typeof content.formatted_body === 'string'
      ? stripFallbackFromFormattedBody(content.formatted_body, names)
      : undefined;

  return {
    ...content,
    body,
    format: formattedBody ? content.format : undefined,
    formatted_body: formattedBody || undefined,
  };
};

export const getGalleryPreview = (content: IGalleryContent): string => {
  const caption = getGalleryCaptionContent(content)?.body;
  if (caption) return caption;
  const count = getGalleryItems(content).length;
  return `Gallery (${count} ${count === 1 ? 'item' : 'items'})`;
};
