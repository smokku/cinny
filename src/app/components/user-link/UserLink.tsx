import React, { ReactEventHandler } from 'react';
import { useAtomValue } from 'jotai';
import { getMatrixToUser } from '../../plugins/matrix-to';
import { makeMentionCustomProps } from '../../plugins/react-custom-html-parser';
import { getMxIdLocalPart } from '../../utils/matrix';
import { nicknamesAtom } from '../../state/nicknames';
import { useUserProfile } from '../../hooks/useUserProfile';
import * as css from './UserLink.css';

type UserLinkProps = {
  userId: string;
  forceName?: string;
  onClick?: ReactEventHandler<HTMLElement>;
};

export function UserLink({ userId, forceName, onClick }: UserLinkProps) {
  const nicknames = useAtomValue(nicknamesAtom);
  const profile = useUserProfile(userId);

  const displayName =
    forceName ?? nicknames?.[userId] ?? profile.displayName ?? getMxIdLocalPart(userId) ?? userId;

  return (
    <a
      href={getMatrixToUser(userId)}
      {...makeMentionCustomProps(onClick)}
      className={css.UserLink}
      data-mention-id={userId}
    >
      <b>{displayName}</b>
    </a>
  );
}
