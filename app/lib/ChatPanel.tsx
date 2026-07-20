"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import { COLOURS, RADII, SHADOWS } from "./SharedUI";
import { formatDateTimeUK } from "./dateUtils";

// ── Types ─────────────────────────────────────────────────────────

type Participant = {
  member_id: string;
  name: string;
  email: string;
};

type Conversation = {
  conversation_id: string;
  name: string | null;
  is_group: boolean;
  updated_at: string;
  last_message: string | null;
  last_message_at: string | null;
  last_message_sender: string | null;
  unread_count: number;
  participants: Participant[] | null;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_name: string;
  sender_email: string;
  content: string;
  created_at: string;
};

type MemberOption = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  department: string | null;
};

type View = "list" | "conversation" | "new-chat";

// ── Helpers ───────────────────────────────────────────────────────

function convDisplayName(conv: Conversation, myEmail: string): string {
  if (conv.is_group && conv.name) return conv.name;
  if (!conv.participants || conv.participants.length === 0) return "Chat";
  if (!conv.is_group) return conv.participants[0]?.name ?? conv.participants[0]?.email ?? "Chat";
  return conv.participants.map((p) => p.name.split(" ")[0]).join(", ");
}

function convInitials(conv: Conversation): string {
  const name = conv.is_group
    ? (conv.name ?? "G")
    : (conv.participants?.[0]?.name ?? "?");
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function memberInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarColor(seed: string): string {
  const palette = [
    "#3B4CCA", "#0F7B5F", "#B4791F", "#64748B", "#0F1720",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

// ── Main component ────────────────────────────────────────────────

type Props = {
  email: string | null;
  memberId: string | null; // from AuthWrapper's member.id
  memberName: string;
};

export default function ChatPanel({ email, memberId, memberName }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<MemberOption[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [creatingConv, setCreatingConv] = useState(false);
  const [convSearch, setConvSearch] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const totalUnread = conversations.reduce((s, c) => s + (c.unread_count ?? 0), 0);

  // ── Load conversations ──────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    if (!memberId) return;
    setLoadingConvs(true);
    const { data, error } = await supabase.rpc("get_my_conversations", {
      p_member_id: memberId,
    });
    if (!error && data) setConversations(data as Conversation[]);
    setLoadingConvs(false);
  }, [memberId]);

  useEffect(() => {
    if (isOpen) loadConversations();
  }, [isOpen, loadConversations]);

  // Realtime: refresh conversation list when any message arrives
  useEffect(() => {
    if (!email || !isOpen) return;
    const ch = supabase
      .channel("chat-conv-refresh")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" },
        () => loadConversations())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [email, isOpen, loadConversations]);

  // ── Load messages for active conversation ───────────────────────

  const loadMessages = useCallback(async (convId: string, before?: string) => {
    if (!before) setLoadingMsgs(true); else setLoadingMore(true);
    const url = `/api/chat/messages?conversation_id=${convId}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    const res = await authedFetch(url);
    const data: Message[] = await res.json();
    if (before) {
      setMessages((prev) => [...data, ...prev]);
      setHasMore(data.length === 50);
    } else {
      setMessages(data);
      setHasMore(data.length === 50);
    }
    if (!before) setLoadingMsgs(false); else setLoadingMore(false);
  }, []);

  useEffect(() => {
    if (!activeConv) return;
    loadMessages(activeConv.conversation_id);
    // Update unread count locally
    setConversations((prev) =>
      prev.map((c) =>
        c.conversation_id === activeConv.conversation_id ? { ...c, unread_count: 0 } : c
      )
    );
  }, [activeConv, loadMessages]);

  // Realtime: new messages in active conversation
  useEffect(() => {
    if (!activeConv) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    const ch = supabase
      .channel(`chat-messages-${activeConv.conversation_id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "chat_messages",
        filter: `conversation_id=eq.${activeConv.conversation_id}`,
      }, (payload) => {
        const msg = payload.new as Message;
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
        );
        // Stamp read on the server (fire and forget)
        authedFetch(`/api/chat/messages?conversation_id=${activeConv.conversation_id}`);
      })
      .subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [activeConv]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (!loadingMore) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loadingMore]);

  // Focus input when conversation opens
  useEffect(() => {
    if (view === "conversation") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [view]);

  // ── Load all members (for new chat picker) ──────────────────────

  const loadMembers = useCallback(async () => {
    if (allMembers.length > 0) return;
    const { data } = await supabase
      .from("members")
      .select("id, email, name, first_name, last_name, role, department")
      .eq("is_active", true)
      .neq("email", email ?? "")
      .order("first_name");
    if (data) {
      setAllMembers(
        data.map((m) => ({
          id: m.id,
          email: m.email,
          display_name:
            `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() ||
            m.name ||
            m.email,
          role: m.role,
          department: m.department,
        }))
      );
    }
  }, [email, allMembers.length]);

  const openNewChat = () => {
    loadMembers();
    setSelectedMembers([]);
    setMemberSearch("");
    setGroupName("");
    setView("new-chat");
  };

  // ── Send message ────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!activeConv || !newMessage.trim() || sending) return;
    setSending(true);
    const content = newMessage.trim();
    setNewMessage("");
    const res = await authedFetch("/api/chat/messages", {
      method: "POST",
      body: JSON.stringify({ conversation_id: activeConv.conversation_id, content }),
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error ?? "Failed to send message");
      setNewMessage(content);
    }
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Create conversation ─────────────────────────────────────────

  const createConversation = async () => {
    if (selectedMembers.length === 0) return;
    if (selectedMembers.length > 1 && !groupName.trim()) {
      showToast("Please enter a group name");
      return;
    }
    setCreatingConv(true);
    const isGroup = selectedMembers.length > 1;
    const res = await authedFetch("/api/chat/conversations", {
      method: "POST",
      body: JSON.stringify({
        participant_emails: selectedMembers.map((m) => m.email),
        name: isGroup ? groupName.trim() : undefined,
        is_group: isGroup,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error ?? "Failed to create conversation");
      setCreatingConv(false);
      return;
    }
    await loadConversations();
    // Find the conversation object and open it
    const { data: convData } = await supabase.rpc("get_my_conversations", {
      p_member_id: memberId,
    });
    const found = (convData as Conversation[] | null)?.find(
      (c) => c.conversation_id === data.conversation_id
    );
    if (found) {
      setActiveConv(found);
      setView("conversation");
    } else {
      setView("list");
    }
    setCreatingConv(false);
  };

  // ── Toast ───────────────────────────────────────────────────────

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // ── Filtered conversations/members ──────────────────────────────

  const filteredConvs = convSearch.trim()
    ? conversations.filter((c) => {
        const display = convDisplayName(c, email ?? "").toLowerCase();
        return display.includes(convSearch.toLowerCase());
      })
    : conversations;

  const filteredMembers = memberSearch.trim()
    ? allMembers.filter(
        (m) =>
          m.display_name.toLowerCase().includes(memberSearch.toLowerCase()) ||
          m.email.toLowerCase().includes(memberSearch.toLowerCase())
      )
    : allMembers;

  if (!email) return null;

  // ── Styles ──────────────────────────────────────────────────────

  const { NAVY, CARD, BORDER, GREEN, SLATE, INK_700, INK_400, BLUE, CANVAS, SUCCESS_SOFT, INK_300 } = COLOURS;

  const panelWidth = 360;

  return (
    <>
      {/* ── Floating button ── */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        aria-label="Open chat"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: NAVY,
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: SHADOWS.MODAL,
          zIndex: 1200,
          transition: "transform 0.15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {/* Chat bubble icon */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"
            fill="white"
          />
        </svg>
        {/* Unread badge */}
        {totalUnread > 0 && (
          <span style={{
            position: "absolute",
            top: 0,
            right: 0,
            minWidth: 18,
            height: 18,
            borderRadius: 999,
            background: "#B3261E",
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 4px",
            border: "2px solid #fff",
          }}>
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>

      {/* ── Slide-in panel ── */}
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          bottom: 88,
          right: 24,
          width: panelWidth,
          maxWidth: "calc(100vw - 32px)",
          height: "min(600px, calc(100vh - 120px))",
          borderRadius: RADII.LG,
          background: CARD,
          border: `1px solid ${BORDER}`,
          boxShadow: SHADOWS.MODAL,
          zIndex: 1199,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          // Slide-in animation
          transform: isOpen ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "transform 0.2s ease, opacity 0.2s ease",
          transformOrigin: "bottom right",
        }}
      >
        {/* ── Panel header ── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          padding: "14px 16px",
          borderBottom: `1px solid ${BORDER}`,
          gap: 8,
          flexShrink: 0,
        }}>
          {view !== "list" && (
            <button
              onClick={() => {
                if (view === "conversation") { setActiveConv(null); setMessages([]); }
                setView("list");
              }}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: SLATE,
                padding: "4px 6px 4px 0",
                display: "flex",
                alignItems: "center",
              }}
              aria-label="Back"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}

          <span style={{
            fontFamily: "var(--font-display)",
            fontSize: 15,
            fontWeight: 600,
            color: NAVY,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {view === "list" && "Messages"}
            {view === "new-chat" && "New Message"}
            {view === "conversation" && activeConv && convDisplayName(activeConv, email ?? "")}
          </span>

          {view === "list" && (
            <button
              onClick={openNewChat}
              title="Start new conversation"
              style={{
                background: "none",
                border: `1px solid ${BORDER}`,
                borderRadius: RADII.PILL,
                cursor: "pointer",
                color: NAVY,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              New
            </button>
          )}

          <button
            onClick={() => setIsOpen(false)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: SLATE,
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
            aria-label="Close chat"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Views ── */}

        {/* LIST view */}
        {view === "list" && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            {/* Search */}
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
              <input
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
                placeholder="Search conversations…"
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  border: `1px solid ${BORDER}`,
                  borderRadius: RADII.SM,
                  fontSize: 13,
                  color: NAVY,
                  background: CANVAS,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {loadingConvs ? (
                <div style={{ padding: 24, textAlign: "center", color: SLATE, fontSize: 13 }}>
                  Loading…
                </div>
              ) : filteredConvs.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center" }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
                  <div style={{ fontSize: 13, color: SLATE }}>No conversations yet.</div>
                  <div style={{ fontSize: 12, color: INK_400, marginTop: 4 }}>
                    Click <strong>New</strong> to start one.
                  </div>
                </div>
              ) : (
                filteredConvs.map((conv) => (
                  <button
                    key={conv.conversation_id}
                    onClick={() => {
                      setActiveConv(conv);
                      setView("conversation");
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "10px 14px",
                      background: "none",
                      border: "none",
                      borderBottom: `1px solid ${BORDER}`,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = CANVAS)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      background: avatarColor(conv.conversation_id),
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}>
                      {convInitials(conv)}
                    </div>

                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 4 }}>
                        <span style={{
                          fontSize: 13,
                          fontWeight: conv.unread_count > 0 ? 600 : 500,
                          color: NAVY,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {convDisplayName(conv, email ?? "")}
                        </span>
                        <span style={{ fontSize: 10, color: INK_400, flexShrink: 0 }}>
                          {timeAgo(conv.last_message_at)}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <span style={{
                          fontSize: 11,
                          color: conv.unread_count > 0 ? INK_700 : SLATE,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontWeight: conv.unread_count > 0 ? 500 : 400,
                        }}>
                          {conv.last_message
                            ? (conv.is_group && conv.last_message_sender
                                ? `${conv.last_message_sender.split(" ")[0]}: ${conv.last_message}`
                                : conv.last_message)
                            : "No messages yet"}
                        </span>
                        {conv.unread_count > 0 && (
                          <span style={{
                            minWidth: 18,
                            height: 18,
                            borderRadius: 999,
                            background: BLUE,
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: "0 4px",
                            flexShrink: 0,
                          }}>
                            {conv.unread_count > 99 ? "99+" : conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* NEW CHAT view */}
        {view === "new-chat" && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            {/* Selected members chips */}
            {selectedMembers.length > 0 && (
              <div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: "8px 12px",
                borderBottom: `1px solid ${BORDER}`,
                flexShrink: 0,
              }}>
                {selectedMembers.map((m) => (
                  <span key={m.id} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    background: CANVAS,
                    border: `1px solid ${BORDER}`,
                    borderRadius: RADII.PILL,
                    fontSize: 12,
                    color: NAVY,
                  }}>
                    {m.display_name.split(" ")[0]}
                    <button
                      onClick={() => setSelectedMembers((prev) => prev.filter((x) => x.id !== m.id))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: SLATE, padding: 0, lineHeight: 1, display: "flex" }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Group name (only shown for multi-select) */}
            {selectedMembers.length > 1 && (
              <div style={{ padding: "8px 12px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group name (required)…"
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    border: `1px solid ${BORDER}`,
                    borderRadius: RADII.SM,
                    fontSize: 13,
                    color: NAVY,
                    background: CANVAS,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}

            {/* Member search */}
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
              <input
                autoFocus
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search members…"
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  border: `1px solid ${BORDER}`,
                  borderRadius: RADII.SM,
                  fontSize: 13,
                  color: NAVY,
                  background: CANVAS,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Member list */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {filteredMembers.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: SLATE, fontSize: 13 }}>
                  No members found
                </div>
              ) : (
                filteredMembers.map((m) => {
                  const isSelected = selectedMembers.some((s) => s.id === m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        setSelectedMembers((prev) =>
                          isSelected ? prev.filter((s) => s.id !== m.id) : [...prev, m]
                        );
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "9px 14px",
                        background: isSelected ? SUCCESS_SOFT : "none",
                        border: "none",
                        borderBottom: `1px solid ${BORDER}`,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{
                        width: 34,
                        height: 34,
                        borderRadius: "50%",
                        background: isSelected ? GREEN : avatarColor(m.id),
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 600,
                        flexShrink: 0,
                        transition: "background 0.15s",
                      }}>
                        {isSelected ? "✓" : memberInitials(m.display_name)}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: NAVY }}>{m.display_name}</div>
                        <div style={{ fontSize: 11, color: SLATE }}>{m.role}{m.department ? ` · ${m.department}` : ""}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Start button */}
            {selectedMembers.length > 0 && (
              <div style={{ padding: "10px 12px", borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
                <button
                  onClick={createConversation}
                  disabled={creatingConv || (selectedMembers.length > 1 && !groupName.trim())}
                  style={{
                    width: "100%",
                    padding: "9px 16px",
                    background: creatingConv ? SLATE : NAVY,
                    color: "#fff",
                    border: "none",
                    borderRadius: RADII.PILL,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: creatingConv ? "not-allowed" : "pointer",
                  }}
                >
                  {creatingConv
                    ? "Starting…"
                    : selectedMembers.length > 1
                    ? `Start group (${selectedMembers.length} people)`
                    : `Message ${selectedMembers[0].display_name.split(" ")[0]}`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* CONVERSATION view */}
        {view === "conversation" && activeConv && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            {/* Participants sub-header for groups */}
            {activeConv.is_group && activeConv.participants && (
              <div style={{
                padding: "6px 14px",
                borderBottom: `1px solid ${BORDER}`,
                fontSize: 11,
                color: SLATE,
                flexShrink: 0,
              }}>
                {activeConv.participants.map((p) => p.name.split(" ")[0]).join(", ")}
              </div>
            )}

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 4px" }}>
              {/* Load more */}
              {hasMore && !loadingMore && messages.length > 0 && (
                <div style={{ textAlign: "center", marginBottom: 8 }}>
                  <button
                    onClick={() => {
                      const oldest = messages[0]?.created_at;
                      if (oldest && activeConv) loadMessages(activeConv.conversation_id, oldest);
                    }}
                    style={{
                      background: "none",
                      border: `1px solid ${BORDER}`,
                      borderRadius: RADII.PILL,
                      cursor: "pointer",
                      color: SLATE,
                      fontSize: 11,
                      padding: "4px 12px",
                    }}
                  >
                    Load earlier messages
                  </button>
                </div>
              )}
              {loadingMsgs ? (
                <div style={{ textAlign: "center", color: SLATE, fontSize: 13, padding: 24 }}>Loading…</div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: "center", color: SLATE, fontSize: 13, padding: 24 }}>
                  No messages yet. Say hello!
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isMe = msg.sender_email === email;
                  const prevMsg = i > 0 ? messages[i - 1] : null;
                  const showSender = !isMe && (
                    !prevMsg ||
                    prevMsg.sender_email !== msg.sender_email ||
                    new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 5 * 60 * 1000
                  );
                  const showTime = (
                    !prevMsg ||
                    new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() > 15 * 60 * 1000
                  );

                  return (
                    <div key={msg.id}>
                      {showTime && (
                        <div style={{ textAlign: "center", fontSize: 10, color: INK_400, margin: "8px 0 4px" }}>
                          {formatDateTimeUK(msg.created_at)}
                        </div>
                      )}
                      {showSender && activeConv.is_group && (
                        <div style={{ fontSize: 10, color: SLATE, marginBottom: 2, marginLeft: 2 }}>
                          {msg.sender_name}
                        </div>
                      )}
                      <div style={{
                        display: "flex",
                        justifyContent: isMe ? "flex-end" : "flex-start",
                        marginBottom: 4,
                      }}>
                        {!isMe && showSender && (
                          <div style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: avatarColor(msg.sender_email),
                            color: "#fff",
                            fontSize: 9,
                            fontWeight: 600,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            marginRight: 6,
                            flexShrink: 0,
                            alignSelf: "flex-end",
                            marginBottom: 2,
                          }}>
                            {memberInitials(msg.sender_name)}
                          </div>
                        )}
                        {!isMe && !showSender && <div style={{ width: 30, flexShrink: 0 }} />}
                        <div style={{
                          maxWidth: "75%",
                          padding: "8px 12px",
                          borderRadius: isMe
                            ? "14px 14px 4px 14px"
                            : "14px 14px 14px 4px",
                          background: isMe ? NAVY : CANVAS,
                          color: isMe ? "#fff" : NAVY,
                          fontSize: 13,
                          lineHeight: 1.45,
                          wordBreak: "break-word",
                          border: isMe ? "none" : `1px solid ${BORDER}`,
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            <div style={{
              padding: "10px 12px",
              borderTop: `1px solid ${BORDER}`,
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              flexShrink: 0,
            }}>
              <textarea
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send)"
                rows={1}
                maxLength={2000}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  border: `1px solid ${BORDER}`,
                  borderRadius: RADII.SM,
                  fontSize: 13,
                  color: NAVY,
                  background: CANVAS,
                  outline: "none",
                  resize: "none",
                  fontFamily: "var(--font-sans)",
                  lineHeight: 1.4,
                  maxHeight: 96,
                  overflowY: "auto",
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!newMessage.trim() || sending}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: newMessage.trim() && !sending ? NAVY : INK_300,
                  border: "none",
                  cursor: newMessage.trim() && !sending ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "background 0.15s",
                }}
                aria-label="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ── Toast ── */}
        {toast && (
          <div style={{
            position: "absolute",
            bottom: 70,
            left: 12,
            right: 12,
            background: "#B3261E",
            color: "#fff",
            borderRadius: RADII.SM,
            padding: "8px 12px",
            fontSize: 12,
            textAlign: "center",
            zIndex: 10,
          }}>
            {toast}
          </div>
        )}
      </div>
    </>
  );
}
