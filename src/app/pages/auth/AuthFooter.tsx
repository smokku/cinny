import React from 'react';
import { Box, Text } from 'folds';
import * as css from './styles.css';
import { clientBranding, useClientConfig } from '../../hooks/useClientConfig';

export function AuthFooter() {
  const clientConfig = useClientConfig();
  const branding = clientBranding(clientConfig);

  return (
    <Box className={css.AuthFooter} justifyContent="Center" gap="400" wrap="Wrap">
      <Text as="a" size="T300" href="https://cinny.in" target="_blank" rel="noreferrer">
        About
      </Text>
      {branding.version ? (
        <Text
          as="a"
          size="T300"
          href={`${branding.sourceUrl}/releases`}
          target="_blank"
          rel="noreferrer"
        >
          v{branding.version}
        </Text>
      ) : (
        <Text as="a" size="T300" href={branding.sourceUrl} target="_blank" rel="noreferrer">
          Source
        </Text>
      )}
      <Text as="a" size="T300" href="https://twitter.com/cinnyapp" target="_blank" rel="noreferrer">
        Twitter
      </Text>
      <Text as="a" size="T300" href="https://matrix.org" target="_blank" rel="noreferrer">
        Powered by Matrix
      </Text>
    </Box>
  );
}
