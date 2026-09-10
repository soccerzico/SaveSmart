import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Page, PageHeader } from "../components/layout/Page.jsx";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Icon,
} from "../components/ui";

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
  const inputRef = useRef(null);

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
      inputRef.current?.focus();
    }
  }

  return (
    <Page>
      <PageHeader
        title="Assistant"
        subtitle="Reads your balances, goals and snapshot history — it never changes them"
        actions={
          <Badge tone="brand" icon="sparkles">
            Claude Haiku
          </Badge>
        }
      />

      {configured === false && (
        <Alert tone="warning" title="Assistant not configured">
          Add <code>ANTHROPIC_API_KEY</code> to <code>backend/.env</code> and
          restart the backend to enable chat.
        </Alert>
      )}

      {configured && (
        <Card className="chat card--flush">
          <div className="chat-log" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="chat-empty">
                <EmptyState icon="sparkles" title="Ask about your money">
                  Goals, balances, cashflow, or how any of it has moved since
                  your first snapshot.
                </EmptyState>
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      onClick={() => send(s)}
                      disabled={sending}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`bubble bubble--${m.role}`}>
                  {m.content}
                </div>
              ))
            )}
            {sending && (
              <div className="bubble bubble--assistant bubble--typing">
                <span className="typing-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="sr-only">Assistant is typing</span>
              </div>
            )}
          </div>

          {error && (
            <CardBody tight>
              <Alert tone="error">{error}</Alert>
            </CardBody>
          )}

          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label className="sr-only" htmlFor="assistant-input">
              Message the assistant
            </label>
            <input
              id="assistant-input"
              className="input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your finances…"
              disabled={sending}
              autoComplete="off"
            />
            <Button
              type="submit"
              variant="primary"
              icon="send"
              disabled={sending || !input.trim()}
            >
              Send
            </Button>
          </form>
        </Card>
      )}

      {configured && (
        <p className="u-sm u-muted row" style={{ gap: "var(--s-2)" }}>
          <Icon name="shield" size={14} />
          Your figures are sent to Anthropic to answer each question. Nothing is
          written back to your accounts.
        </p>
      )}
    </Page>
  );
}
