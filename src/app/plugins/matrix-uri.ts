import { tryDecodeURIComponent } from '../utils/dom';
import { MatrixToRoom } from './matrix-to';

/**
 * Parser for the `matrix:` URI scheme as defined in the Matrix spec appendix.
 * Examples:
 *   matrix:u/alice:example.org?action=chat
 *   matrix:r/somewhere:example.org
 *   matrix:roomid/somewhere:example.org/e/event?via=elsewhere.ca
 */

const MATRIX_URI_SCHEME = 'matrix:';

const ENTITY_SIGILS: Record<string, string> = {
  u: '@',
  r: '#',
  roomid: '!',
  e: '$',
  // types used by MSC2312 drafts, still produced by some clients
  user: '@',
  room: '#',
  event: '$',
};

export type MatrixUriUser = {
  userId: string;
};

export type MatrixUriRoom = MatrixToRoom & {
  eventId?: string;
};

export type MatrixUri = MatrixUriUser | MatrixUriRoom;

export const testMatrixUri = (uri: string): boolean =>
  uri.toLowerCase().startsWith(MATRIX_URI_SCHEME);

const getEntityId = (type: string, idWithoutSigil: string): string | undefined => {
  const sigil = ENTITY_SIGILS[type];
  if (!sigil || !idWithoutSigil) return undefined;
  return `${sigil}${tryDecodeURIComponent(idWithoutSigil)}`;
};

export const parseMatrixUri = (uri: string): MatrixUri | undefined => {
  if (!testMatrixUri(uri)) return undefined;

  const [hierAndQuery] = uri.slice(MATRIX_URI_SCHEME.length).split('#');
  const queryIndex = hierAndQuery.indexOf('?');
  let path = queryIndex > -1 ? hierAndQuery.slice(0, queryIndex) : hierAndQuery;
  const query = queryIndex > -1 ? hierAndQuery.slice(queryIndex + 1) : '';

  // authority is reserved by the spec for future use, skip it
  if (path.startsWith('//')) {
    const authorityEnd = path.indexOf('/', 2);
    if (authorityEnd === -1) return undefined;
    path = path.slice(authorityEnd + 1);
  }

  const segments = path.split('/');
  if (segments.length !== 2 && segments.length !== 4) return undefined;

  const primaryId = getEntityId(segments[0], segments[1]);
  if (!primaryId) return undefined;

  if (primaryId.startsWith('@')) {
    if (segments.length !== 2) return undefined;
    return { userId: primaryId };
  }

  if (primaryId.startsWith('$')) return undefined;

  let eventId: string | undefined;
  if (segments.length === 4) {
    eventId = getEntityId(segments[2], segments[3]);
    if (!eventId?.startsWith('$')) return undefined;
  }

  const viaServers = new URLSearchParams(query).getAll('via');

  return {
    roomIdOrAlias: primaryId,
    eventId,
    viaServers: viaServers.length === 0 ? undefined : viaServers,
  };
};
