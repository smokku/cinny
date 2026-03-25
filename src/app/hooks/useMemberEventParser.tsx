import React, { ReactEventHandler, ReactNode } from 'react';
import { IconSrc, Icons } from 'folds';
import { MatrixEvent } from 'matrix-js-sdk';
import { IMemberContent, Membership } from '../../types/matrix/room';
import { getMxIdLocalPart } from '../utils/matrix';
import { isMembershipChanged } from '../utils/room';
import { UserLink } from '../components/user-link';

export type ParsedResult = {
  icon: IconSrc;
  body: ReactNode;
};

export type MemberEventParser = (mEvent: MatrixEvent) => ParsedResult;

export const useMemberEventParser = (
  handleMentionClick?: ReactEventHandler<HTMLElement>
): MemberEventParser => {
  const parseMemberEvent: MemberEventParser = (mEvent) => {
    const content = mEvent.getContent<IMemberContent>();
    const prevContent = mEvent.getPrevContent() as IMemberContent;
    const senderId = mEvent.getSender();
    const userId = mEvent.getStateKey();
    const reason = typeof content.reason === 'string' ? content.reason : undefined;

    if (!senderId || !userId)
      return {
        icon: Icons.User,
        body: 'Broken membership event',
      };

    if (isMembershipChanged(mEvent)) {
      if (content.membership === Membership.Invite) {
        if (prevContent.membership === Membership.Knock) {
          return {
            icon: Icons.ArrowGoRightPlus,
            body: (
              <>
                <UserLink userId={senderId} onClick={handleMentionClick} />
                {' accepted '}
                <UserLink userId={userId} forceName={userId} onClick={handleMentionClick} />
                {`'s join request `}
                {reason}
              </>
            ),
          };
        }

        return {
          icon: Icons.ArrowGoRightPlus,
          body: (
            <>
              <UserLink userId={senderId} onClick={handleMentionClick} />
              {' invited '}
              <UserLink userId={userId} forceName={userId} onClick={handleMentionClick} /> {reason}
            </>
          ),
        };
      }

      if (content.membership === Membership.Knock) {
        return {
          icon: Icons.ArrowGoRightPlus,
          body: (
            <>
              <UserLink userId={userId} forceName={userId} onClick={handleMentionClick} />
              {' request to join room '}
              {reason}
            </>
          ),
        };
      }

      if (content.membership === Membership.Join) {
        return {
          icon: Icons.ArrowGoRight,
          body: (
            <>
              <UserLink userId={userId} onClick={handleMentionClick} />
              {' joined the room'}
            </>
          ),
        };
      }

      if (content.membership === Membership.Leave) {
        if (prevContent.membership === Membership.Invite) {
          return {
            icon: Icons.ArrowGoRightCross,
            body:
              senderId === userId ? (
                <>
                  <UserLink userId={userId} onClick={handleMentionClick} />
                  {' rejected the invitation '}
                  {reason}
                </>
              ) : (
                <>
                  <UserLink userId={senderId} onClick={handleMentionClick} />
                  {' rejected '}
                  <UserLink userId={userId} onClick={handleMentionClick} />
                  {`'s join request `}
                  {reason}
                </>
              ),
          };
        }

        if (prevContent.membership === Membership.Knock) {
          return {
            icon: Icons.ArrowGoRightCross,
            body:
              senderId === userId ? (
                <>
                  <UserLink userId={userId} onClick={handleMentionClick} />
                  {' revoked joined request '}
                  {reason}
                </>
              ) : (
                <>
                  <UserLink userId={senderId} onClick={handleMentionClick} />
                  {' revoked '}
                  <UserLink userId={userId} onClick={handleMentionClick} />
                  {`'s invite `}
                  {reason}
                </>
              ),
          };
        }

        if (prevContent.membership === Membership.Ban) {
          return {
            icon: Icons.ArrowGoLeft,
            body: (
              <>
                <UserLink userId={senderId} onClick={handleMentionClick} />
                {' unbanned '}
                <UserLink userId={userId} onClick={handleMentionClick} /> {reason}
              </>
            ),
          };
        }

        return {
          icon: Icons.ArrowGoLeft,
          body:
            senderId === userId ? (
              <>
                <UserLink userId={userId} onClick={handleMentionClick} />
                {' left the room '}
                {reason}
              </>
            ) : (
              <>
                <UserLink userId={senderId} onClick={handleMentionClick} />
                {' kicked '}
                <UserLink userId={userId} onClick={handleMentionClick} /> {reason}
              </>
            ),
        };
      }

      if (content.membership === Membership.Ban) {
        return {
          icon: Icons.ArrowGoLeft,
          body: (
            <>
              <UserLink userId={senderId} onClick={handleMentionClick} />
              {' banned '}
              <UserLink userId={userId} onClick={handleMentionClick} /> {reason}
            </>
          ),
        };
      }
    }

    if (content.displayname !== prevContent.displayname) {
      const prevUserName =
        typeof prevContent.displayname === 'string'
          ? prevContent.displayname || (getMxIdLocalPart(userId) ?? userId)
          : getMxIdLocalPart(userId) ?? userId;

      return {
        icon: Icons.Mention,
        body:
          typeof content.displayname === 'string' ? (
            <>
              <UserLink userId={userId} forceName={prevUserName} onClick={handleMentionClick} />
              {' changed display name to '}
              <b>{content.displayname}</b>
            </>
          ) : (
            <>
              <UserLink userId={userId} forceName={prevUserName} onClick={handleMentionClick} />
              {' removed their display name '}
            </>
          ),
      };
    }
    if (content.avatar_url !== prevContent.avatar_url) {
      return {
        icon: Icons.User,
        body:
          content.avatar_url && typeof content.avatar_url === 'string' ? (
            <>
              <UserLink userId={userId} onClick={handleMentionClick} />
              {' changed their avatar'}
            </>
          ) : (
            <>
              <UserLink userId={userId} onClick={handleMentionClick} />
              {' removed their avatar '}
            </>
          ),
      };
    }

    return {
      icon: Icons.User,
      body: 'Membership event with no changes',
    };
  };

  return parseMemberEvent;
};
