import { atom } from 'jotai';
import { removeAccountRoomsAtom } from './room-list/roomList';
import { removeAccountInvitesAtom } from './room-list/inviteList';
import { removeAccountMDirectAtom } from './mDirectList';
import { removeAccountParentsAtom } from './room/roomToParents';
import { removeAccountUnreadAtom } from './room/roomToUnread';
import { removeAccountBookmarksAtom } from './bookmarks';
import { removeAccountNicknamesAtom } from './nicknames';

/**
 * Remove all per-account atom data for a given userId.
 * Called during targeted logout to clean up without affecting other accounts.
 */
export const cleanupAccountAtomsAtom = atom(null, (_get, set, userId: string) => {
  set(removeAccountRoomsAtom, userId);
  set(removeAccountInvitesAtom, userId);
  set(removeAccountMDirectAtom, userId);
  set(removeAccountParentsAtom, userId);
  set(removeAccountUnreadAtom, userId);
  set(removeAccountBookmarksAtom, userId);
  set(removeAccountNicknamesAtom, userId);
});
