import { run } from '../git/process.js';
import { DEVICE_URL, REVOKE_URL } from '../github/app.js';

/** No shell interpolation, arbitrary URLs, or browser output in logs. */
export async function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  execute: typeof run = run,
): Promise<boolean> {
  if (url !== DEVICE_URL && url !== REVOKE_URL)
    throw new Error('Unexpected browser destination');
  const command =
    platform === 'darwin'
      ? 'open'
      : platform === 'win32'
        ? 'rundll32'
        : 'xdg-open';
  const args =
    platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  try {
    await execute(command, args, { timeout: 5000, maxOutput: 4096 });
    return true;
  } catch {
    return false;
  }
}
