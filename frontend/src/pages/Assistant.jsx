import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

const SUGGESTIONS = [
  "How am I doing on my goals?",
  "How has my net worth changed?",
  "Where can I cut expenses to save faster?",
];

export default function Assistant() {
  const [configured, setConfigured] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    api
      .get("/assistant/status")
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, sending]);

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setError("");
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      // Send the running history so the model has conversational context.
      const { reply } = await api.post("/assistant/chat", { messages: next });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err.message);
      // Roll back the optimistic user turn so they can retry.
      setMessages(messages);
      setInput(content);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">SaveSmart</h1>
        <nav className="topbar-right">
          <Link className="navlink" to="/">
            ← Dashboard
          </Link>
        </nav>
      </header>

      <section className="container">
        <div className="section-head">
          <h2>Assistant</h2>
          <span className="muted small">Claude Haiku · reads your snapshots</span>
        </div>

        {configured === false && (
          <div className="callout">
            <strong>Assistant not configured.</strong>
            <p className="muted small">
              Add <code>ANTHROPIC_API_KEY</code> to <code>backend/.env</code> and
              restart the backend to enable chat.
            </p>
          </div>
        )}

        {configured && (
          <div className="chat card">
            <div className="chat-log" ref={scrollRef}>
              {messages.length === 0 && (
                <div className="chat-empty">
                  <p className="muted">
                    Ask about your goals, balances, or progress over time.
                  </p>
                  <div className="chips">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        className="chip"
                        onClick={() => send(s)}
                        disabled={sending}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`bubble ${m.role}`}>
                  {m.content}
                </div>
              ))}
              {sending && <div className="bubble assistant typing">Thinking…</div>}
            </div>

            {error && <p className="error small">{error}</p>}

            <form
              className="chat-input"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your finances…"
                disabled={sending}
              />
              <button type="submit" disabled={sending || !input.trim()}>
                Send
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
