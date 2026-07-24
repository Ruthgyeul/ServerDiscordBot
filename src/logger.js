import pino from 'pino';
import { config } from './config.js';

/**
 * Application logger.
 *
 * In development we use `pino-pretty` for human-readable, colorized output.
 * In production we emit structured JSON on stdout, which journald captures
 * cleanly when the bot runs under systemd (`journalctl -u serverdiscordbot`).
 */
const isProduction = config.env === 'production';

export const logger = pino({
  level: config.logLevel,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
});

/**
 * Create a child logger tagged with a component name for easy filtering.
 * @param {string} name
 */
export function childLogger(name) {
  return logger.child({ component: name });
}
