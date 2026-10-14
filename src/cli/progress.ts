import { stripVTControlCharacters } from 'node:util';

export type ScanStage = 'discovery' | 'git' | 'audit' | 'export' | 'done';
export interface ProgressEvent {
  stage: ScanStage;
  message: string;
  completed?: number;
  total?: number;
  requests?: number;
}
export type Progress = (event: ProgressEvent) => void;
const labels: Record<ScanStage, string> = {
  discovery: 'Discover public activity',
  git: 'Inspect Git changes',
  audit: 'Audit and score',
  export: 'Render and save',
  done: 'Complete',
};
const stages: ScanStage[] = ['discovery', 'git', 'audit', 'export'];
const clean = (text: string) =>
  stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f]/g, ' ');

/** Percentages represent processed repositories, never exhaustive contribution coverage. */
export function progressBar(completed: number, total: number): string {
  const fraction = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
  const filled = Math.floor(fraction * 16);
  return `[${'#'.repeat(filled)}${'-'.repeat(16 - filled)}] ${completed}/${total}`;
}

/** Fixed live status block for TTYs; only stage transitions for redirected logs. */
export class ScanProgress {
  private event: ProgressEvent | undefined;
  private lastStage: ScanStage | undefined;
  private lines = 0;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private readonly stream: Pick<
      NodeJS.WriteStream,
      'write' | 'isTTY' | 'columns'
    > = process.stderr,
  ) {}

  readonly update: Progress = (event) => {
    this.event = event;
    if (!this.stream.isTTY) {
      if (this.lastStage !== event.stage)
        this.stream.write(`${labels[event.stage]}: ${clean(event.message)}\n`);
      this.lastStage = event.stage;
      return;
    }
    if (!this.timer) {
      this.stream.write('\x1b[?25l');
      this.timer = setInterval(() => this.draw(), 120);
      this.timer.unref();
    }
    this.draw();
  };

  private draw(): void {
    if (!this.event) return;
    const { stage, message, completed, total, requests } = this.event;
    const current = stage === 'done' ? stages.length : stages.indexOf(stage);
    const width = Math.max(10, (this.stream.columns || 80) - 1);
    const spinner = ['|', '/', '-', '\\'][this.frame++ % 4];
    const rows = stages.map(
      (s, i) =>
        `  ${i < current ? '+' : i === current ? spinner : '.'} ${labels[s]}`,
    );
    rows.push(`  ${clean(message)}`);
    rows.push(
      stage === 'git' && total !== undefined && completed !== undefined
        ? `  Repositories ${progressBar(completed, total)}`
        : requests !== undefined
          ? `  API requests: ${requests}`
          : '',
    );
    if (this.lines) this.stream.write(`\x1b[${this.lines}A\r\x1b[J`);
    this.stream.write(`${rows.map((row) => row.slice(0, width)).join('\n')}\n`);
    this.lines = rows.length;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.stream.write('\x1b[?25h');
    }
  }
}
