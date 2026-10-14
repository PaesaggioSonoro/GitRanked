export const VERSION = '1.0.0';
export { score, SCORING } from './scoring/index.js';
export { audit, RULES } from './antifarming/index.js';
export {
  makeReport,
  validateReport,
  reportSchema,
  serializeReport,
} from './report/index.js';
export type { Report } from './report/index.js';
export type { Activity, Discovery, Repository } from './report/model.js';
