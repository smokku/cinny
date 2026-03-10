export type PronounSet = {
  summary: string;
  language?: string;
  grammatical_gender?: string;
};

export function parsePronounsInput(pronouns: string): PronounSet[] {
  if (!pronouns || typeof pronouns !== 'string') return [];

  return pronouns
    .split(',')
    .map((s) => s?.trim())
    .filter(Boolean)
    .map((s) => {
      const parts = s.split(':');

      if (parts.length === 1) {
        return {
          summary: (parts[0] || '').slice(0, 16),
          language: 'en',
        };
      }

      const [language, summary] = parts;

      return {
        language: (language || 'en').trim() || 'en',
        summary: (summary || '').trim().slice(0, 16),
      };
    });
}
