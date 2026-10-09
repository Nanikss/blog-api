/** Milliseconds since the epoch. Injected wherever time matters so tests can control it. */
export type Clock = () => number;

export const systemClock: Clock = () => Date.now();
