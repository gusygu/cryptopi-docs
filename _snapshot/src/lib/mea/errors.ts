export class MeaConfigError extends Error {
  constructor(msg: string) { super(`[MEA] ${msg}`); }
}
