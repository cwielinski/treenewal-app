import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Ask the dashboard a question.
 *
 * Conversations sit on the left, grouped by category, and can be renamed or
 * recategorised. The right side is the conversation itself. Everything is
 * private to the person signed in.
 */

const SUGGESTIONS = [
  "Which type of work makes the most money once overhead is allocated?",
  "How does this month compare with the same month last year?",
  "What is driving the backlog right now?",
  "Where is cash tightest in the next quarter?",
];

type Thread = {
  _id: Id<"chatThreads">;
  title: string;
  category: string;
  updatedAt: number;
};

export function ChatPage() {
  const threads = useQuery(api.chat.listThreads, {});
  const [activeId, setActiveId] = useState<Id<"chatThreads"> | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "chat">("list");
  const ask = useAction(api.chat.ask);
  const rename = useMutation(api.chat.renameThread);
  const remove = useMutation(api.chat.deleteThread);

  const messages = useQuery(
    api.chat.messages,
    activeId ? { threadId: activeId } : "skip",
  );
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, busy]);

  const grouped = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const thread of threads ?? []) {
      const list = map.get(thread.category) ?? [];
      list.push(thread);
      map.set(thread.category, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [threads]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setDraft("");
    setBusy(true);
    try {
      const result = await ask({
        threadId: activeId ?? undefined,
        question,
      });
      setActiveId(result.threadId);
      setMobilePane("chat");
    } finally {
      setBusy(false);
    }
  }

  const active = (threads ?? []).find(thread => thread._id === activeId) ?? null;

  return (
    <div className="tn-chat" data-pane={mobilePane}>
      <aside className="tn-chat-list">
        <button
          type="button"
          className="tn-btn"
          style={{ width: "100%" }}
          onClick={() => {
            setActiveId(null);
            setMobilePane("chat");
          }}
        >
          New conversation
        </button>

        {threads === undefined ? (
          <div className="tn-chat-empty">Loading.</div>
        ) : threads.length === 0 ? (
          <div className="tn-chat-empty">
            No conversations yet. Ask a question and one starts here.
          </div>
        ) : (
          grouped.map(([category, list]) => (
            <div key={category} style={{ display: "grid", gap: 4 }}>
              <div className="tn-label" style={{ color: "var(--tn-fg-subtle)" }}>
                {category}
              </div>
              {list.map(thread => (
                <button
                  key={thread._id}
                  type="button"
                  className={`tn-chat-item${thread._id === activeId ? " on" : ""}`}
                  onClick={() => {
                    setActiveId(thread._id);
                    setMobilePane("chat");
                  }}
                >
                  {thread.title}
                </button>
              ))}
            </div>
          ))
        )}
      </aside>

      <section className="tn-chat-main">
        <div className="tn-chat-head">
          <button
            type="button"
            className="tn-linkbtn tn-chat-back"
            onClick={() => setMobilePane("list")}
          >
            Conversations
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <div className="tn-heading tn-chat-title" style={{ fontSize: 20 }}>
              {active ? active.title : "Ask the dashboard"}
            </div>
            {active ? (
              <div style={{ fontSize: 13, color: "var(--tn-fg-subtle)" }}>
                {active.category}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--tn-fg-subtle)" }}>
                Answers come from the same figures the screens show, for the
                periods they are held for.
              </div>
            )}
          </div>
          {active ? (
            <div className="tn-chat-actions">
              <button
                type="button"
                className="tn-linkbtn"
                onClick={async () => {
                  const title = window.prompt("Name this conversation", active.title);
                  if (title) await rename({ threadId: active._id, title });
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="tn-linkbtn"
                onClick={async () => {
                  const category = window.prompt(
                    "Category, for example Cash, Crews, Marketing",
                    active.category,
                  );
                  if (category) await rename({ threadId: active._id, category });
                }}
              >
                Category
              </button>
              <button
                type="button"
                className="tn-linkbtn"
                onClick={async () => {
                  if (!window.confirm("Delete this conversation")) return;
                  await remove({ threadId: active._id });
                  setActiveId(null);
                }}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>

        <div className="tn-chat-body">
          {!activeId ? (
            <div style={{ display: "grid", gap: 8, maxWidth: 620 }}>
              <div style={{ fontSize: 14, color: "var(--tn-fg-subtle)" }}>
                A few things people ask:
              </div>
              {SUGGESTIONS.map(item => (
                <button
                  key={item}
                  type="button"
                  className="tn-chat-suggestion"
                  onClick={() => void send(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          ) : messages === undefined ? (
            <div className="tn-chat-empty">Loading.</div>
          ) : (
            messages.map(message => (
              <div
                key={message._id}
                className={`tn-chat-msg ${message.author}`}
                style={message.failed ? { color: "var(--tn-fg-subtle)" } : undefined}
              >
                {message.text}
              </div>
            ))
          )}
          {busy ? <div className="tn-chat-empty">Working on it.</div> : null}
          <div ref={endRef} />
        </div>

        <form
          className="tn-chat-composer"
          onSubmit={event => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <input
            className="tn-input"
            style={{ flex: 1 }}
            placeholder="Ask about the numbers"
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
          <button type="submit" className="tn-btn" disabled={busy || !draft.trim()}>
            Ask
          </button>
        </form>
      </section>
    </div>
  );
}
