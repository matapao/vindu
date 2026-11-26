// The time as terminals and pages keep it: each command, log line and failure says when, in UTC.

/** This moment, as an ISO 8601 time in UTC. */
export const now = (): string => new Date().toISOString();
/** A pause of ms milliseconds. */
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
