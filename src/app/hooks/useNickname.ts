import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect } from 'react';
import { ClientEvent, ClientEventHandlerMap, MatrixClient } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { nicknamesAtom, setAccountNicknamesAtom, setNicknameAtom } from '../state/nicknames';
import { useMatrixClient } from './useMatrixClient';

export const useNickname = (userId: string): string | undefined => {
  const nicknames = useAtomValue(nicknamesAtom);
  return nicknames[userId];
};

export const useSetNickname = () => {
  const mx = useMatrixClient();
  const setNick = useSetAtom(setNicknameAtom);

  return useCallback(
    (userId: string, nick: string | undefined) => {
      setNick(userId, nick, mx);
    },
    [mx, setNick]
  );
};

export const useSyncNicknames = (mx?: MatrixClient) => {
  const setAccountNicknames = useSetAtom(setAccountNicknamesAtom);

  useEffect(() => {
    if (!mx) return;
    const accountId = mx.getSafeUserId();
    const event = mx.getAccountData(AccountDataEvent.SableNicknames as any);
    if (event) {
      setAccountNicknames({ accountId, nicknames: event.getContent() || {} });
    }
  }, [mx, setAccountNicknames]);

  useEffect(() => {
    if (!mx) return undefined;
    const accountId = mx.getSafeUserId();

    const onAccountData: ClientEventHandlerMap[ClientEvent.AccountData] = (mEvent) => {
      if (mEvent.getType() === AccountDataEvent.SableNicknames) {
        setAccountNicknames({ accountId, nicknames: mEvent.getContent() || {} });
      }
    };

    mx.on(ClientEvent.AccountData, onAccountData);

    return () => {
      mx.removeListener(ClientEvent.AccountData, onAccountData);
    };
  }, [mx, setAccountNicknames]);
};
