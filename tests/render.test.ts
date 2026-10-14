import { expect, test } from 'vitest';
import { fixture } from './report.test.js';
import { svg, png } from '../src/render/index.js';
test('offline SVG/PNG render with bundled font, escape XML and remain deterministic', async () => {
  const r = fixture();
  r.subject.login = 'a<&"';
  const source = await svg(r);
  expect(source).toContain('a&lt;&amp;&quot;');
  expect(source).toContain('FIXTURE');
  expect(source).toContain('PARTIAL ANALYSIS');
  expect(source).not.toContain('Bearer');
  expect(source).toMatch(/width="1000" height="780"/);
  const data = await png(source);
  expect(Buffer.from(data.subarray(0, 8)).toString('hex')).toBe(
    '89504e470d0a1a0a',
  );
  expect(Buffer.from(data).readUInt32BE(16)).toBe(1000);
  expect(await png(source)).toEqual(data);
});
