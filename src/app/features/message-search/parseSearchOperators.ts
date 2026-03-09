export type ParsedSearch = {
  searchTerm: string;
  fromUsers: string[];
  mentionUsers: string[];
};

const OPERATOR_RE = /(?:^|\s)(from|mentions):(\S+)/g;

export function parseSearchOperators(input: string): ParsedSearch {
  const fromUsers: string[] = [];
  const mentionUsers: string[] = [];

  const searchTerm = input
    .replace(OPERATOR_RE, (match, operator: string, value: string) => {
      if (operator === 'from') {
        fromUsers.push(value);
      } else if (operator === 'mentions') {
        mentionUsers.push(value);
      }
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();

  return { searchTerm, fromUsers, mentionUsers };
}
