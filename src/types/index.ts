/**
 * Single import surface for the type model.
 *
 * Modules import from `types/index.js` regardless of which half a type lives
 * in, so splitting or regrouping the definitions never ripples through the
 * rest of the codebase.
 */
export type * from './config.js';
export type * from './bot.js';
