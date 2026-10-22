import React, { useMemo } from 'react';
import { Box, Icon, Icons, Switch, Text, Tooltip, TooltipProvider, color, config } from 'folds';
import { Link, useSearchParams } from 'react-router-dom';
import { SSOAction } from 'matrix-js-sdk';
import { useAuthFlows } from '../../../hooks/useAuthFlows';
import { useAuthServer } from '../../../hooks/useAuthServer';
import { useParsedLoginFlows } from '../../../hooks/useParsedLoginFlows';
import { PasswordLoginForm } from './PasswordLoginForm';
import { SSOLogin } from '../SSOLogin';
import { TokenLogin } from './TokenLogin';
import { OrDivider } from '../OrDivider';
import { getLoginPath, getRegisterPath, withSearchParam } from '../../pathUtils';
import { usePathWithOrigin } from '../../../hooks/usePathWithOrigin';
import { LoginPathSearchParams } from '../../paths';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { useSetting } from '../../../state/hooks/settings';
import { settingsAtom } from '../../../state/settings';

const getLoginTokenSearchParam = () => {
  // when using hasRouter query params in existing route
  // gets ignored by react-router, so we need to read it ourself
  // we only need to read loginToken as it's the only param that
  // is provided by external entity. example: SSO login
  const parmas = new URLSearchParams(window.location.search);
  const loginToken = parmas.get('loginToken');
  return loginToken ?? undefined;
};

const useLoginSearchParams = (searchParams: URLSearchParams): LoginPathSearchParams =>
  useMemo(
    () => ({
      username: searchParams.get('username') ?? undefined,
      email: searchParams.get('email') ?? undefined,
      loginToken: searchParams.get('loginToken') ?? undefined,
    }),
    [searchParams]
  );

// Large accounts may never finish a classic initial sync, so sliding sync can be
// picked before logging in rather than only from the settings.
function SlidingSyncLoginOption() {
  const [slidingSync, setSlidingSync] = useSetting(settingsAtom, 'slidingSync');

  return (
    <Box alignItems="Center" justifyContent="SpaceBetween" gap="300">
      <Box alignItems="Center" gap="100">
        <Text as="label" htmlFor="login-sliding-sync" size="T300" priority="400">
          Use sliding sync
        </Text>
        <TooltipProvider
          delay={300}
          tooltip={
            <Tooltip style={{ maxWidth: '240px', padding: config.space.S200 }}>
              <Text size="T200">
                Sliding sync loads rooms on demand and needs server support. You can toggle it later
                in Settings at any time.
              </Text>
            </Tooltip>
          }
        >
          {(triggerRef) => (
            <Icon ref={triggerRef} size="100" src={Icons.Info} aria-label="About sliding sync" />
          )}
        </TooltipProvider>
      </Box>
      <Switch
        id="login-sliding-sync"
        variant="Primary"
        value={slidingSync}
        onChange={setSlidingSync}
      />
    </Box>
  );
}

export function Login() {
  const server = useAuthServer();
  const { hashRouter } = useClientConfig();
  const { loginFlows } = useAuthFlows();
  const [searchParams] = useSearchParams();
  const loginSearchParams = useLoginSearchParams(searchParams);
  const ssoRedirectUrl = usePathWithOrigin(getLoginPath(server));
  const loginTokenForHashRouter = getLoginTokenSearchParam();
  const absoluteLoginPath = usePathWithOrigin(getLoginPath(server));

  if (hashRouter?.enabled && loginTokenForHashRouter) {
    window.location.replace(
      withSearchParam(absoluteLoginPath, {
        loginToken: loginTokenForHashRouter,
      })
    );
  }

  const parsedFlows = useParsedLoginFlows(loginFlows.flows);

  return (
    <Box direction="Column" gap="500">
      <Text size="H2" priority="400">
        Login
      </Text>
      {parsedFlows.token && loginSearchParams.loginToken && (
        <TokenLogin token={loginSearchParams.loginToken} />
      )}
      {parsedFlows.password && (
        <>
          <PasswordLoginForm
            defaultUsername={loginSearchParams.username}
            defaultEmail={loginSearchParams.email}
          />
          <span data-spacing-node />
          {parsedFlows.sso && <OrDivider />}
        </>
      )}
      {parsedFlows.sso && (
        <>
          <SSOLogin
            providers={parsedFlows.sso.identity_providers}
            redirectUrl={ssoRedirectUrl}
            action={SSOAction.LOGIN}
            saveScreenSpace={parsedFlows.password !== undefined}
          />
          <span data-spacing-node />
        </>
      )}
      {!parsedFlows.password && !parsedFlows.sso && (
        <>
          <Text style={{ color: color.Critical.Main }}>
            {`This client does not support login on "${server}" homeserver. Password and SSO based login method not found.`}
          </Text>
          <span data-spacing-node />
        </>
      )}
      <SlidingSyncLoginOption />
      <Text align="Center">
        Do not have an account? <Link to={getRegisterPath(server)}>Register</Link>
      </Text>
    </Box>
  );
}
