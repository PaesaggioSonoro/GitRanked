import { expect, test } from 'vitest';
import { openBrowser } from '../src/cli/browser.js';
import { DEVICE_URL } from '../src/github/app.js';

test('browser opening uses platform arguments without a shell and offers fallback', async () => {
  for (const [platform, command, args] of [
    ['darwin', 'open', [DEVICE_URL]],
    ['linux', 'xdg-open', [DEVICE_URL]],
    ['win32', 'rundll32', ['url.dll,FileProtocolHandler', DEVICE_URL]],
  ] as const) {
    const calls: unknown[] = [];
    expect(
      await openBrowser(DEVICE_URL, platform, async (cmd, argv) => {
        calls.push([cmd, argv]);
        return '';
      }),
    ).toBe(true);
    expect(calls).toEqual([[command, args]]);
  }
  expect(
    await openBrowser(DEVICE_URL, 'linux', async () => {
      throw new Error('sensitive child output');
    }),
  ).toBe(false);
  await expect(openBrowser('https://example.com')).rejects.toThrow(
    'destination',
  );
});
