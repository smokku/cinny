import React from 'react';
import { Box, Button, Icon, Icons, Text, config, toRem } from 'folds';
import { Page, PageHero, PageHeroSection } from '../../components/page';
import { clientBranding, useClientConfig } from '../../hooks/useClientConfig';

export function WelcomePage() {
  const clientConfig = useClientConfig();
  const branding = clientBranding(clientConfig);
  const isCustomBranding = !!clientConfig.branding && clientConfig.branding.enabled;

  return (
    <Page>
      <Box
        grow="Yes"
        style={{ padding: config.space.S400, paddingBottom: config.space.S700 }}
        alignItems="Center"
        justifyContent="Center"
      >
        <PageHeroSection>
          <PageHero
            icon={<img height="70" src={branding.logo} alt={`${branding.name} Logo`} />}
            title={`Welcome to ${branding.name}`}
            subTitle={
              branding.version && (
                <span>
                  Yet another matrix client.{' '}
                  <a
                    href={`${branding.sourceUrl}/releases`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    v{branding.version}
                  </a>
                </span>
              )
            }
          >
            <Box justifyContent="Center">
              <Box grow="Yes" style={{ maxWidth: toRem(300) }} direction="Column" gap="300">
                {branding.sourceUrl && (
                  <Button
                    as="a"
                    href={branding.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    before={<Icon size="200" src={Icons.Code} />}
                  >
                    <Text as="span" size="B400" truncate>
                      Source Code
                    </Text>
                  </Button>
                )}
                {isCustomBranding ? (
                  <Text as="span" size="T200" align="Center">
                    Powered by{' '}
                    <a href="https://cinny.in/#sponsor" target="_blank" rel="noreferrer noopener">
                      Cinny
                    </a>
                  </Text>
                ) : (
                  <Button
                    as="a"
                    href="https://cinny.in/#sponsor"
                    target="_blank"
                    rel="noreferrer noopener"
                    fill="Soft"
                    before={<Icon size="200" src={Icons.Heart} />}
                  >
                    <Text as="span" size="B400" truncate>
                      Support
                    </Text>
                  </Button>
                )}
              </Box>
            </Box>
          </PageHero>
        </PageHeroSection>
      </Box>
    </Page>
  );
}
