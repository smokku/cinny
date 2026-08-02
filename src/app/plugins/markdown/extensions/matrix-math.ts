import type { TokenizerExtension, RendererExtension } from 'marked';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isIgnorableMathContent(latex: string): boolean {
  const t = latex.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (t === '') return true;
  return /^\$+$/.test(t);
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
  if (!src.startsWith('$')) {
    return undefined;
  }
  if (src.startsWith('$$') && (src.length < 3 || src.charAt(2) !== '$')) {
    return undefined;
  }
  if (src.length < 3 || /\s/.test(src.charAt(1))) {
    return undefined;
  }
  for (let j = 1; j < src.length; j += 1) {
    const after = j + 1 < src.length ? src.charAt(j + 1) : '';
    const latex = src.slice(1, j);
    const isClosingDollar =
      src.charAt(j) === '$' &&
      !/\s/.test(src.charAt(j - 1)) &&
      !(after !== '' && /[0-9]/.test(after)) &&
      !isIgnorableMathContent(latex) &&
      !latex.trimStart().startsWith('$$');
    if (isClosingDollar) {
      return {
        type: 'math',
        raw: src.slice(0, j + 1),
        latex,
      };
    }
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
      const latex = match[1]?.trim() ?? '';
      if (isIgnorableMathContent(latex)) return undefined;
      return {
        type: 'mathBlock',
        raw: match[0],
        latex,
      };
    }
    return undefined;
  },
  renderer(token) {
    return `<div data-mx-maths="${escapeHtml(token.latex)}">${token.latex}</div>`;
  },
} satisfies TokenizerExtension & RendererExtension;
