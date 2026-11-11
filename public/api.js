// The only fetch call site. Paths are relative ("inventory" → api/inventory),
// so they resolve under /plugins/code-skill/ when embedded in cc.

export class ApiError extends Error {
  constructor(code, message, status, body) {
    super(message);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  if (path.startsWith('/')) throw new Error(`api(): "${path}" must be relative`);
  let res;
  try {
    res = await fetch(`api/${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError('NETWORK', `Code Skill's backend is unreachable (${e.message})`, 0, null);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.code ?? `HTTP_${res.status}`, data?.message ?? res.statusText, res.status, data);
  return data;
}
