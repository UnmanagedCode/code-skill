import { promises as fs } from 'node:fs';

const CHUNK = 1 << 20;
const NEEDLE = Buffer.from('"Skill"');
const NL = 0x0a;

// Skill tool calls in the complete lines of `file` from byte `offset` on.
// Only lines holding the bytes "Skill" are parsed; only `assistant` records
// count (the same tool_use is copied into api-request-blob records). A
// trailing line without "\n" is left for the next scan.
// → { calls: [{ id, skill, ts, sessionId }], newOffset, bytesRead, malformed }
export async function scanFileFrom(file, offset) {
  const fh = await fs.open(file, 'r');
  const calls = [];
  let malformed = 0;
  let pos = offset;
  let consumed = offset;
  let carry = Buffer.alloc(0);
  try {
    const buf = Buffer.alloc(CHUNK);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, CHUNK, pos);
      if (bytesRead === 0) break;
      pos += bytesRead;
      const data = carry.length ? Buffer.concat([carry, buf.subarray(0, bytesRead)]) : Buffer.from(buf.subarray(0, bytesRead));
      let start = 0;
      for (let nl = data.indexOf(NL, start); nl !== -1; nl = data.indexOf(NL, start)) {
        const line = data.subarray(start, nl);
        if (line.indexOf(NEEDLE) !== -1) {
          const r = parseLine(line);
          if (r === null) malformed++;
          else calls.push(...r);
        }
        start = nl + 1;
      }
      carry = Buffer.from(data.subarray(start));
      consumed = pos - carry.length;
    }
  } finally {
    await fh.close();
  }
  return { calls, newOffset: consumed, bytesRead: pos - offset, malformed };
}

// → calls[] for one JSONL line, or null when it is not JSON.
export function parseLine(line) {
  let rec;
  try {
    rec = JSON.parse(line.toString('utf8'));
  } catch {
    return null;
  }
  if (rec?.type !== 'assistant' || !Array.isArray(rec.message?.content)) return [];
  const out = [];
  for (const item of rec.message.content) {
    if (item?.type === 'tool_use' && item.name === 'Skill' && typeof item.input?.skill === 'string' && typeof item.id === 'string') {
      out.push({ id: item.id, skill: item.input.skill, ts: typeof rec.timestamp === 'string' ? rec.timestamp : null, sessionId: rec.sessionId ?? null });
    }
  }
  return out;
}
