import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTHENTICATED_MEDIA_UNSTABLE_FEATURE,
  requestMediaConfig,
  requestMediaConfigFromServerVersions,
  supportsAuthenticatedMedia,
} from './mediaAuthentication';

test('supports authenticated media for stable spec support', () => {
  assert.equal(
    supportsAuthenticatedMedia({
      versions: ['v1.11'],
    }),
    true
  );
});

test('supports authenticated media for unstable feature support', () => {
  assert.equal(
    supportsAuthenticatedMedia({
      versions: [],
      unstable_features: {
        [AUTHENTICATED_MEDIA_UNSTABLE_FEATURE]: true,
      },
    }),
    true
  );
});

test('does not support authenticated media without version or feature support', () => {
  assert.equal(
    supportsAuthenticatedMedia({
      versions: ['v1.10'],
      unstable_features: {
        [AUTHENTICATED_MEDIA_UNSTABLE_FEATURE]: false,
      },
    }),
    false
  );
});

test('requests authenticated media config when support is available', async () => {
  const expected = { 'm.upload.size': 1 };
  let receivedArgument: boolean | undefined;

  const result = await requestMediaConfig(
    {
      getMediaConfig: async (useAuthenticatedMedia?: boolean) => {
        receivedArgument = useAuthenticatedMedia;
        return expected;
      },
    },
    { versions: ['v1.11'] }
  );

  assert.equal(receivedArgument, true);
  assert.deepEqual(result, expected);
});

test('requests legacy media config when support is unavailable', async () => {
  const expected = { 'm.upload.size': 1 };
  let receivedArgument: boolean | undefined;

  const result = await requestMediaConfig(
    {
      getMediaConfig: async (useAuthenticatedMedia?: boolean) => {
        receivedArgument = useAuthenticatedMedia;
        return expected;
      },
    },
    { versions: ['v1.10'] }
  );

  assert.equal(receivedArgument, false);
  assert.deepEqual(result, expected);
});

test('loads versions before requesting media config for widget flows', async () => {
  const calls: string[] = [];
  let receivedArgument: boolean | undefined;

  const expected = { 'm.upload.size': 1 };
  const result = await requestMediaConfigFromServerVersions({
    getVersions: async () => {
      calls.push('versions');
      return { versions: [], unstable_features: { [AUTHENTICATED_MEDIA_UNSTABLE_FEATURE]: true } };
    },
    getMediaConfig: async (useAuthenticatedMedia?: boolean) => {
      calls.push('media-config');
      receivedArgument = useAuthenticatedMedia;
      return expected;
    },
  });

  assert.deepEqual(calls, ['versions', 'media-config']);
  assert.equal(receivedArgument, true);
  assert.deepEqual(result, expected);
});
