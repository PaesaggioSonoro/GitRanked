/** Public application identifier; safe to distribute in the npm package. */
export const GITHUB_APP_CLIENT_ID = 'Iv23lifRY1rPYNaMNGes';
export const DEVICE_URL = 'https://github.com/login/device';
export const REVOKE_URL = 'https://github.com/settings/apps/authorizations';

export function appClientId(override?: string): string {
  return override ?? process.env.GITRANKED_CLIENT_ID ?? GITHUB_APP_CLIENT_ID;
}
