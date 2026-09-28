import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import {
  INTRO, planTurn, formatReading, formatObstacles, formatApproval, formatNext, formatPolicy, formatUtilityPolicy, formatCompare,
} from './site-chat.js';

const CURSOR_CLIENT_TIMEOUT_MS = 160000;
// Chat can wait on Cursor for ~70–150s; Vite's default proxy dies around 20s with an empty body.
const CHAT_URL = import.meta.env.DEV ? 'http://localhost:8787/api/chat' : '/api/chat';

async function parseResponseJSON(response) {
  const raw = await response.text();
  if (!raw.trim()) {
    const error = new Error('empty-body');
    error.code = 'EMPTY_BODY';
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('bad-json');
    error.code = 'BAD_JSON';
    throw error;
  }
}

async function getJSON(url) {
  const response = await fetch(url);
  const data = await parseResponseJSON(response);
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function postJSON(url, body, { timeoutMs } = {}) {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    const data = await parseResponseJSON(response);
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTransportFailure(error) {
  const code = error?.code || error?.name;
  return code === 'EMPTY_BODY' || code === 'BAD_JSON' || code === 'AbortError' || code === 'TimeoutError'
    || /Unexpected end of JSON|Failed to fetch|NetworkError|abort/i.test(String(error?.message || error || ''));
}

export default function SiteChat({ scenario, policy, selected, estimate, lifted, onOpenParcel, onUseScenario, onCompare }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const introduced = useRef(false);
  const listRef = useRef(null);
  const selectedId = selected?.lookupId || selected?.pin || '';

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, open]);

  function reveal() {
    setOpen(true);
    if (introduced.current) return;
    introduced.current = true;
    setMessages([{ role: 'assistant', text: INTRO }]);
  }

  async function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setMessages((previous) => [...previous, { role: 'user', text }]);
    setBusy(true);
    try {
      const answer = await reply(text);
      if (!answer.facts) {
        setMessages((previous) => [...previous, { role: 'assistant', text: answer }]);
        return;
      }
      const messageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setMessages((previous) => [...previous, { role: 'assistant', id: messageId, text: answer.facts }]);
      setBusy(false);
      const spoken = await withModel(text, answer.facts);
      if (spoken && spoken !== answer.facts) {
        setMessages((previous) => previous.map((message) => (
          message.id === messageId ? { ...message, text: spoken } : message
        )));
      }
    } catch (error) {
      const fallback = isTransportFailure(error)
        ? 'The mapped records could not be loaded just now. Try that parcel again.'
        : (error.message || 'Something went wrong.');
      setMessages((previous) => [...previous, { role: 'assistant', text: fallback }]);
    } finally {
      setBusy(false);
    }
  }

  async function withModel(question, facts) {
    try {
      const data = await postJSON(CHAT_URL, { question, facts }, { timeoutMs: CURSOR_CLIENT_TIMEOUT_MS });
      const text = typeof data?.text === 'string' ? data.text.trim() : '';
      return text || facts;
    } catch (error) {
      if (isTransportFailure(error)) return facts;
      return facts;
    }
  }

  async function reply(text) {
    const plan = planTurn(text, { scenario, hasSelection: Boolean(selectedId) });
    if (plan.intent === 'help') return INTRO;
    if (plan.intent === 'compare') {
      const ids = plan.ids.length >= 2 ? plan.ids : (selectedId && plan.ids.length === 1 ? [selectedId, plan.ids[0]] : plan.ids);
      if (ids.length < 2 || ids.length > 5) return 'Name two to five parcel IDs, for example 85-N-171 and 85-N-163.';
      onCompare(ids, plan.scenario);
      const data = await postJSON('/api/compare', { ids, scenario: plan.scenario, policy });
      const title = { starter: 'Starter home', duplex: 'Two-unit home', fourplex: 'Small multi-unit', reuse: 'Repair or enlarge' }[plan.scenario];
      return formatCompare(data, title);
    }
    const id = plan.ids[0] || ((plan.aboutCurrent || plan.intent !== 'help') ? selectedId : '');
    if (!id) return 'Name a parcel ID, such as 85-N-171, or select one on the map.';
    if (plan.scenario !== scenario) onUseScenario(plan.scenario);
    if (id !== selectedId) onOpenParcel(id);
    const sameParcel = id === selectedId && selected?.evaluation?.scenario?.id === plan.scenario;
    const evaluation = sameParcel
      ? selected.evaluation
      : await getJSON(`/api/site-evaluation?pin=${encodeURIComponent(id)}&scenario=${plan.scenario}`);
    if (plan.intent === 'obstacles') return { facts: formatObstacles(evaluation) };
    if (plan.intent === 'approval') return { facts: formatApproval(evaluation) };
    if (plan.intent === 'next') return { facts: formatNext(evaluation) };
    if (plan.intent === 'policy') {
      if (plan.utilityQuestion && !plan.policy.allowResidentialUse && !plan.policy.meetPublishedMinimum) return { facts: formatUtilityPolicy(estimate?.result) };
      const named = Object.values(plan.policy).some(Boolean);
      if (!named) return { facts: formatPolicy(evaluation, null) };
      const data = await postJSON('/api/compare', { ids: [id], scenario: plan.scenario, policy: plan.policy });
      return { facts: formatPolicy(evaluation, data.results?.[0]?.evaluation?.policyImpact) };
    }
    let screened = sameParcel && estimate?.status === 'ready' ? estimate.result : null;
    if (!screened) {
      try {
        const scored = await postJSON('/api/ai-score', { id, scenario: plan.scenario });
        screened = scored.result;
      } catch {
        screened = null;
      }
    }
    return { facts: formatReading(evaluation, screened) };
  }

  return <div className={`site-chat ${open ? 'open' : ''} ${lifted ? `lift-${lifted}` : ''}`}>
    {open && <section className="site-chat-panel" role="dialog" aria-label="Site assistant">
      <header><span>SITE ASSISTANT</span><button type="button" onClick={() => setOpen(false)} aria-label="Close site assistant"><X size={16} /></button></header>
      <div className="site-chat-log" ref={listRef}>
        {messages.map((message, index) => <p key={message.id || `${message.role}-${index}`} className={message.role}>{message.text}</p>)}
        {busy && <p className="assistant pending">Checking the mapped records…</p>}
      </div>
      <form onSubmit={submit}>
        <label htmlFor="site-chat-input" className="visually-hidden">Ask about a parcel</label>
        <input id="site-chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask, look up, or compare" disabled={busy} />
        <button type="submit" aria-label="Send" disabled={busy || !draft.trim()}><Send size={16} /></button>
      </form>
    </section>}
    {!open && <button className="site-chat-launcher" type="button" onClick={reveal}>
      <MessageCircle size={18} /> Ask
    </button>}
  </div>;
}
