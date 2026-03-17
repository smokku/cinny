import { Logger } from 'matrix-js-sdk/lib/logger';

const noop = (..._args: any[]): void => {};

export const quietMatrixLogger: Logger = {
  trace: noop,
  debug: noop,
  info: (...args: unknown[]): void => console.info(...args),
  warn: (...args: unknown[]): void => console.warn(...args),
  error: (...args: unknown[]): void => console.error(...args),
  getChild: (_namespace: string) => quietMatrixLogger,
};
