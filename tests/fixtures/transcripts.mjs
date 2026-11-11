// Transcript line builders copying the record shapes the CLI writes.
export const skillCall = ({ id, skill, ts = '2026-11-01T10:00:00.000Z', sessionId = 'sess-1', cwd = '/w' }) => JSON.stringify({
  type: 'assistant', timestamp: ts, sessionId, cwd, isSidechain: false, uuid: `u-${id}`,
  message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id, name: 'Skill', input: { skill } }] },
});

// The same tool_use copied into an api-request-blob record.
export const blobCopy = ({ id, skill }) => JSON.stringify({
  type: 'api-request-blob', timestamp: '2026-11-01T10:00:01.000Z',
  request: { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id, name: 'Skill', input: { skill } }] }] },
});

export const skillResult = ({ id, skill }) => JSON.stringify({
  type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `Launching skill: ${skill}` }] },
  toolUseResult: { success: true, commandName: skill },
});

export const commandRecord = (name) => JSON.stringify({ type: 'user', message: { role: 'user', content: `<command-name>/${name}</command-name>` } });

export const MALFORMED = '{"type":"assistant","name":"Skill" this is not json';

export const lines = (...ls) => `${ls.join('\n')}\n`;
