import { rulesGuide } from './jev-input.js';
import { slimCandidate } from './jev-client.js';

const TERMINAL = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);

function publicError(error) {
  return String(error?.message || error).replace(/apikey_\S+/gi, '[key]').replace(/crsr_\S+/gi, '[key]');
}

function cursorRoot() {
  return (process.env.CURSOR_API_URL || 'https://api.cursor.com').replace(/\/$/, '');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readingPrompt(input, jev) {
  const ready = (input?.candidates || []).filter((candidate) => candidate.score && !candidate.error).map(slimCandidate);
  const links = [];
  for (const candidate of input?.candidates || []) {
    for (const entry of [...(candidate.confirmed || []), ...(candidate.needsVerification || []), ...(candidate.nextActions || []), ...(candidate.approvalPath || [])]) {
      if (entry.source) links.push({ parcel: candidate.id, title: entry.title, href: entry.source });
    }
  }
  const packet = {
    scenario: input?.scenario || null,
    policy: input?.policy || null,
    parcels: ready,
    jev: jev?.choices?.length ? { statement: jev.statement, choices: jev.choices.map((choice) => ({ id: choice.candidateId, probability: choice.probability })) } : null,
    sourceLinks: links.slice(0, 12),
  };
  return `Write a short comparison guide for a Pittsburgh housing screen.

Use only the records in the JSON below. Do not add parcels, scores, probabilities, or links. A mapped by-right use is not an approval. If Jev percentages are present, call them a screening preference provided by Jev, not permit odds. Policy switches are hypothetical and do not change current law.

Reply with one JSON object and no other text:
{"statement":"one sentence","points":[{"heading":"short heading","text":"one or two sentences","links":[{"label":"source name","href":"https://..."}]}]}

Use three or four points: the screening order, what is confirmed, what still needs verification, and where to go next. Copy link hrefs from sourceLinks. Use an empty links array when a point has no source.

Records:
${JSON.stringify(packet)}`;
}

export function chatPrompt(question, facts) {
  return `Answer this question about a Pittsburgh housing site screen.

Question: ${String(question || '').slice(0, 1500)}

Use only the facts below. Do not add parcels, scores, probabilities, or links. A mapped by-right use is not an approval. If the facts include Jev percentages, they are a screening preference provided by Jev, not permit odds. Lead the person to the next action or source already named in the facts. Write plain sentences, not JSON.

Facts:
${String(facts || '').slice(0, 7000)}`;
}

export function parseReading(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.points)) return null;
  const points = parsed.points
    .filter((point) => point && point.heading && point.text)
    .slice(0, 6)
    .map((point) => ({
      heading: String(point.heading).slice(0, 80),
      text: String(point.text).slice(0, 700),
      links: (Array.isArray(point.links) ? point.links : [])
        .filter((link) => typeof link?.href === 'string' && link.href.startsWith('https://'))
        .slice(0, 4)
        .map((link) => ({ label: String(link.label || 'Source').slice(0, 80), href: link.href })),
    }));
  if (!points.length) return null;
  return {
    provider: 'cursor',
    status: 'model',
    statement: String(parsed.statement || 'Point-by-point reading from Cursor, using the mapped records. This is not an approval.').slice(0, 400),
    points,
  };
}

async function deleteAgent(agentId, key) {
  if (!agentId) return;
  await fetch(`${cursorRoot()}/v1/agents/${agentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${key}` },
  }).catch(() => {});
}

export async function runCursorPrompt(text, { timeoutMs = 150000 } = {}) {
  const key = process.env.CURSOR_API_KEY;
  if (!key) throw new Error('Cursor is not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let agentId = null;
  try {
    const created = await fetch(`${cursorRoot()}/v1/agents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Housing site reading',
        mode: 'plan',
        prompt: { text },
      }),
      signal: controller.signal,
    });
    const createdBody = await created.json().catch(() => ({}));
    if (!created.ok) {
      const detail = createdBody.error?.message || createdBody.message || `Cursor request failed (${created.status})`;
      throw new Error(publicError(detail));
    }
    agentId = createdBody.agent?.id;
    const runId = createdBody.run?.id;
    let run = createdBody.run || {};
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (TERMINAL.has(run.status) && run.status !== 'FINISHED') break;
      if (run.status === 'FINISHED' && run.result) break;
      if (attempt > 0) await delay(2000);
      const polled = await fetch(`${cursorRoot()}/v1/agents/${agentId}/runs/${runId}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      const next = await polled.json().catch(() => ({}));
      if (polled.ok) run = next;
    }
    if (run?.status !== 'FINISHED' || !run.result) throw new Error('Cursor did not finish a reading.');
    return String(run.result);
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw new Error('Cursor reading timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
    await deleteAgent(agentId, key);
  }
}

export async function askCursorReading(input, jev) {
  const fallback = rulesGuide(input);
  const ready = (input?.candidates || []).filter((candidate) => candidate.score && !candidate.error);
  if (!process.env.CURSOR_API_KEY || ready.length < 2) return fallback;
  try {
    const text = await runCursorPrompt(readingPrompt(input, jev));
    return parseReading(text) || {
      ...fallback,
      provider: 'cursor',
      status: 'model',
      statement: `Cursor replied, but not as a point list, so the rules guide is shown. ${text.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
    };
  } catch (error) {
    return {
      ...fallback,
      statement: `Cursor did not finish a reading, so this guide stays on the mapped rules. ${publicError(error)}`,
    };
  }
}

export async function askCursorChat(question, facts) {
  const fallback = { status: 'rules', text: String(facts || '') };
  if (!process.env.CURSOR_API_KEY) return fallback;
  try {
    const text = (await runCursorPrompt(chatPrompt(question, facts))).replace(/\s+\n/g, '\n').trim();
    if (!text) return fallback;
    return { status: 'model', text };
  } catch (error) {
    const detail = publicError(error).trim();
    return {
      status: 'rules',
      text: detail ? `${fallback.text}\n\nCursor did not finish a reading.` : fallback.text,
    };
  }
}
