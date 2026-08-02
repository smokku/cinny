import type { TokenizerExtension, RendererExtension } from 'marked';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inline math delimiters use `$...$` but must not greedily pair across dollar amounts
 * (e.g. "$10 ... $20"). We only treat a pair as math when:
 * - the opening `$` is not followed by whitespace, and
 * - the closing `$` is not preceded by whitespace, and
 * - the closing `$` is not immediately followed by an ASCII digit.
 */
function tryTokenizeInlineMath(
  src: string
): { type: 'math'; raw: string; latex: string } | undefined {
  if (!src.startsWith('$') || src.startsWith('$$')) {
    return undefined;
  }
  if (src.length < 3 || /\s/.test(src.charAt(1))) {
    return undefined;
  }
  for (let j = 1; j < src.length; j += 1) {
    if (src.charAt(j) !== '$') continue;
    const before = src.charAt(j - 1);
    if (/\s/.test(before)) continue;
    const after = j + 1 < src.length ? src.charAt(j + 1) : '';
    if (after !== '' && /[0-9]/.test(after)) continue;
    return {
      type: 'math',
      raw: src.slice(0, j + 1),
      latex: src.slice(1, j),
    };
  }
  return undefined;
}

// Inline math: $...$
export const matrixMathExtension = {
  name: 'math',
  level: 'inline',
  start(src: string) {
    return src.indexOf('$');
  },
  tokenizer(src: string) {
    return tryTokenizeInlineMath(src);
  },
  renderer(token) {
    return `<span data-mx-maths="${escapeHtml(token.latex)}">${token.latex}</span>`;
  },
} satisfies TokenizerExtension & RendererExtension;

// Block math: $$...$$
export const matrixMathBlockExtension = {
  name: 'mathBlock',
  level: 'block',
  start(src: string) {
    return src.indexOf('$$');
  },
  tokenizer(src: string) {
    const match = /^\$\$([^$]+)\$\$\n?/.exec(src);
    if (match) {
      return {
        type: 'mathBlock',
        raw: match[0],
        latex: match[1]?.trim() ?? '',
      };
    }
    return undefined;
  },
  renderer(token) {
    return `<div data-mx-maths="${escapeHtml(token.latex)}">${token.latex}</div>`;
  },
} satisfies TokenizerExtension & RendererExtension;
