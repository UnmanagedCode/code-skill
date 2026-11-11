// A deliberate refusal: leaves the API as { ok:false, code, message } with `status`.
export class Refusal extends Error {
  constructor(code, status, message, extra) {
    super(message);
    this.code = code;
    this.status = status;
    if (extra) this.extra = extra;
  }
}

export const refuse = (code, status, message, extra) => { throw new Refusal(code, status, message, extra); };
