import { MatrixClient } from 'matrix-js-sdk';
import { useBindAllInvitesAtom } from '../room-list/inviteList';
import { useBindAllRoomsAtom } from '../room-list/roomList';
import { useBindMDirectAtom } from '../mDirectList';
import { useBindBookmarksAtom } from '../bookmarks';
import { useBindRoomToUnreadAtom } from '../room/roomToUnread';
import { useBindRoomToParentsAtom } from '../room/roomToParents';
import { useBindRoomIdToTypingMembersAtom } from '../typingMembers';

/**
 * Bind all per-account atoms for a single MatrixClient.
 * Called once per account from AccountBootstrapper.
 * Each hook internally resolves the account userId from mx.
 */
export const useBindAtoms = (mx: MatrixClient) => {
  useBindMDirectAtom(mx);
  useBindBookmarksAtom(mx);
  useBindAllInvitesAtom(mx);
  useBindAllRoomsAtom(mx);
  useBindRoomToParentsAtom(mx);
  useBindRoomToUnreadAtom(mx);
  useBindRoomIdToTypingMembersAtom(mx);
};
