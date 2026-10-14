import { expect, test, vi } from 'vitest';
import { ScanProgress, progressBar } from '../src/cli/progress.js';

test('TTY display reuses a fixed status block and restores cursor on success and failure', () => {
  vi.useFakeTimers();
  try {
    const writes: string[] = [];
    const display = new ScanProgress({
      isTTY: true,
      columns: 80,
      write: (text) => {
        writes.push(String(text));
        return true;
      },
    });
    display.update({
      stage: 'discovery',
      message: 'Public profile',
      requests: 1,
    });
    vi.advanceTimersByTime(240);
    display.update({
      stage: 'git',
      message: 'alice/repo\n\x1b[31mplain status',
      completed: 1,
      total: 2,
    });
    const output = writes.join('');
    expect(output).toContain('API requests: 1');
    expect(output).toContain('Repositories [########--------] 1/2');
    expect(output).toContain('\x1b[6A\r\x1b[J');
    expect(output).not.toContain('\x1b[31m');
    expect(output).toContain('alice/repo plain status');
    display.stop();
    expect(writes.at(-1)).toBe('\x1b[?25h');
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('non-TTY logs only stage changes and has no ANSI sequences or per-request noise', () => {
  const writes: string[] = [];
  const display = new ScanProgress({
    isTTY: false,
    columns: 80,
    write: (text) => {
      writes.push(String(text));
      return true;
    },
  });
  for (let requests = 1; requests <= 1000; requests++)
    display.update({
      stage: 'discovery',
      message: 'Fetching public data',
      requests,
    });
  display.update({
    stage: 'git',
    message: 'Processing repositories',
    completed: 0,
    total: 1,
  });
  display.update({ stage: 'audit', message: 'Computing score' });
  display.update({ stage: 'export', message: 'Writing output' });
  display.update({ stage: 'done', message: 'Saved' });
  display.stop();
  expect(writes).toHaveLength(5);
  expect(writes.join('')).not.toContain('\x1b');
  expect(progressBar(0, 0)).toBe('[----------------] 0/0');
  expect(progressBar(1, 1)).toBe('[################] 1/1');
});
