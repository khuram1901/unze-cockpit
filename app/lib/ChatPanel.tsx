"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import { COLOURS, RADII, SHADOWS } from "./SharedUI";
import { formatDateTimeUK } from "./dateUtils";

// ── Types ─────────────────────────────────────────────────────────

type Participant = { member_id: string; name: string; email: string };

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
  is_archived: boolean;
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

// ── Helpers ───────────────────────────────────────────────────────

function convDisplayName(conv: Conversation): string {
  if (conv.is_group && conv.name) return conv.name;
  if (!conv.participants?.length) return "Chat";
  if (!conv.is_group) return conv.participants[0]?.name ?? "Chat";
  return conv.participants.map((p) => p.name.split(" ")[0]).join(", ");
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/);
  return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

function avatarBg(seed: string): string {
  const palette = ["#3B4CCA", "#0F7B5F", "#B4791F", "#64748B", "#0F1720"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(h) % palette.length];
}

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

async function authedFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      ...(opts.headers ?? {}),
    },
  });
}

// ── Tick component ────────────────────────────────────────────────

function Ticks({ read }: { read: boolean }) {
  const color = read ? "#3B4CCA" : "#94A3B8";
  return (
    <svg width="16" height="10" viewBox="0 0 16 10" fill="none" style={{ display: "inline-block", verticalAlign: "middle" }}>
      {/* First tick */}
      <path d="M1 5L4 8L9 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Second tick (offset right — only shown when read) */}
      {read && <path d="M5 5L8 8L13 2" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
      {!read && <path d="M5 5L8 8L13 2" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>}
    </svg>
  );
}

// ── Swipe-to-action row wrapper ───────────────────────────────────
// Swipe right → reveals rightBg (delete). Swipe left → reveals leftBg (archive).
// Works with both touch and mouse drag. Blocks the click event after a real drag.

type SwipeRowProps = {
  leftBg: string;
  leftLabel: string;
  rightBg: string;
  rightLabel: string;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  borderColor: string;
  children: React.ReactNode;
};

function SwipeRow({ leftBg, leftLabel, rightBg, rightLabel, onSwipeLeft, onSwipeRight, borderColor, children }: SwipeRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  // These start at width:0 and grow only when swiping in their direction
  const rightRevealRef = useRef<HTMLDivElement>(null); // red, grows from left on swipe-right
  const leftRevealRef = useRef<HTMLDivElement>(null);  // amber, grows from right on swipe-left
  const startXRef = useRef(0);
  const activeRef = useRef(false);
  const draggedRef = useRef(false);
  const THRESHOLD = 80;

  const reset = () => {
    if (rowRef.current) { rowRef.current.style.transition = "transform 0.2s ease"; rowRef.current.style.transform = "translateX(0)"; }
    if (rightRevealRef.current) rightRevealRef.current.style.width = "0";
    if (leftRevealRef.current) leftRevealRef.current.style.width = "0";
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    activeRef.current = true;
    draggedRef.current = false;
    if (rowRef.current) rowRef.current.style.transition = "none";
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeRef.current) return;
    const delta = e.clientX - startXRef.current;
    if (Math.abs(delta) > 8) draggedRef.current = true;
    const clamped = Math.max(-120, Math.min(120, delta));
    if (rowRef.current) rowRef.current.style.transform = `translateX(${clamped}px)`;
    if (delta > 0) {
      // Swiping right → reveal delete (red) growing from the left
      if (rightRevealRef.current) rightRevealRef.current.style.width = `${Math.min(delta, 120)}px`;
      if (leftRevealRef.current) leftRevealRef.current.style.width = "0";
    } else {
      // Swiping left → reveal archive (amber) growing from the right
      if (leftRevealRef.current) leftRevealRef.current.style.width = `${Math.min(-delta, 120)}px`;
      if (rightRevealRef.current) rightRevealRef.current.style.width = "0";
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const delta = e.clientX - startXRef.current;
    if (delta > THRESHOLD) {
      if (rowRef.current) { rowRef.current.style.transition = "transform 0.18s ease"; rowRef.current.style.transform = "translateX(110%)"; }
      setTimeout(onSwipeRight, 180);
    } else if (delta < -THRESHOLD) {
      if (rowRef.current) { rowRef.current.style.transition = "transform 0.18s ease"; rowRef.current.style.transform = "translateX(-110%)"; }
      setTimeout(onSwipeLeft, 180);
    } else {
      reset();
    }
  };

  return (
    <div style={{ position: "relative", overflow: "hidden", borderBottom: `1px solid ${borderColor}` }}>
      {/* Delete reveal: anchored LEFT, width grows as you swipe right */}
      <div ref={rightRevealRef} style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 0,
        background: rightBg, overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "flex-start",
        paddingLeft: 16, color: "#fff", fontSize: 12, fontWeight: 600,
        pointerEvents: "none", whiteSpace: "nowrap",
      }}>
        {rightLabel}
      </div>
      {/* Archive reveal: anchored RIGHT, width grows as you swipe left */}
      <div ref={leftRevealRef} style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 0,
        background: leftBg, overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "flex-end",
        paddingRight: 16, color: "#fff", fontSize: 12, fontWeight: 600,
        pointerEvents: "none", whiteSpace: "nowrap",
      }}>
        {leftLabel}
      </div>
      {/* The sliding row */}
      <div
        ref={rowRef}
        style={{ position: "relative", zIndex: 1 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={(e) => { if (draggedRef.current) { e.stopPropagation(); e.preventDefault(); } }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

type Props = {
  email: string | null;
  memberId: string | null;
  memberName: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
};

export default function ChatPanel({ email, memberId, memberName, isOpen, onToggle, onClose }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [othersLastReadAt, setOthersLastReadAt] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [openingDm, setOpeningDm] = useState<string | null>(null); // email of member being opened
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const msgChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const readChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const { NAVY, CARD, BORDER, SLATE, INK_400, INK_700, BLUE, CANVAS, INK_300, SUCCESS_SOFT, GREEN } = COLOURS;
  const totalUnread = conversations.reduce((s, c) => s + (c.unread_count ?? 0), 0);

  // ── Load conversations ──────────────────────────────────────────

  const loadConversations = useCallback(async (includeArchived = false) => {
    if (!memberId) return;
    setLoadingConvs(true);
    const { data } = await supabase.rpc("get_my_conversations", {
      p_member_id: memberId,
      p_include_archived: includeArchived,
    });
    if (data) setConversations(data as Conversation[]);
    setLoadingConvs(false);
  }, [memberId]);

  const conversationAction = useCallback(async (
    convId: string,
    action: "archive" | "unarchive" | "delete"
  ) => {
    // Optimistic update
    if (action === "delete") {
      setConversations((prev) => prev.filter((c) => c.conversation_id !== convId));
    } else {
      setConversations((prev) =>
        prev.map((c) =>
          c.conversation_id === convId ? { ...c, is_archived: action === "archive" } : c
        )
      );
    }
    await authedFetch("/api/chat/conversations", {
      method: "PATCH",
      body: JSON.stringify({ conversation_id: convId, action }),
    });
  }, []);

  // Load members once for the people list
  const loadMembers = useCallback(async () => {
    if (allMembers.length > 0 || !email) return;
    const { data } = await supabase
      .from("members")
      .select("id, email, name, first_name, last_name, role, department")
      .eq("is_active", true)
      .neq("email", email)
      .order("first_name");
    if (data) {
      setAllMembers(data.map((m) => ({
        id: m.id,
        email: m.email,
        display_name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || m.name || m.email,
        role: m.role,
        department: m.department,
      })));
    }
  }, [email, allMembers.length]);

  useEffect(() => {
    if (isOpen) { loadConversations(showArchived); loadMembers(); }
  }, [isOpen, loadConversations, loadMembers, showArchived]);

  // Focus search when panel opens
  useEffect(() => {
    if (isOpen && !activeConv) setTimeout(() => searchRef.current?.focus(), 120);
  }, [isOpen, activeConv]);

  // Realtime: refresh conversation list on any new message
  useEffect(() => {
    if (!isOpen || !email) return;
    const ch = supabase
      .channel("chat-list-refresh")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" },
        () => loadConversations())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isOpen, email, loadConversations]);

  // ── Load messages ───────────────────────────────────────────────

  const loadMessages = useCallback(async (convId: string, before?: string) => {
    if (!before) { setLoadingMsgs(true); setMessages([]); }
    else setLoadingMore(true);

    const url = `/api/chat/messages?conversation_id=${convId}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
    const res = await authedFetch(url);
    if (!res.ok) { setLoadingMsgs(false); setLoadingMore(false); return; }

    const payload = await res.json();
    const msgs: Message[] = payload.messages ?? [];
    const readAt: string | null = payload.others_last_read_at ?? null;

    setOthersLastReadAt(readAt);
    if (before) {
      setMessages((prev) => [...msgs, ...prev]);
      setHasMore(msgs.length === 50);
    } else {
      setMessages(msgs);
      setHasMore(msgs.length === 50);
    }
    if (!before) setLoadingMsgs(false); else setLoadingMore(false);
  }, []);

  useEffect(() => {
    if (!activeConv) return;
    loadMessages(activeConv.conversation_id);
    setConversations((prev) =>
      prev.map((c) => c.conversation_id === activeConv.conversation_id ? { ...c, unread_count: 0 } : c)
    );
    setTimeout(() => inputRef.current?.focus(), 150);
  }, [activeConv, loadMessages]);

  // Scroll to bottom when messages load/change (but not on "load more")
  useEffect(() => {
    if (!loadingMore) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loadingMore]);

  // Realtime: new messages in active conversation
  useEffect(() => {
    if (!activeConv) return;
    if (msgChannelRef.current) supabase.removeChannel(msgChannelRef.current);
    const ch = supabase
      .channel(`chat-msg-${activeConv.conversation_id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "chat_messages",
        filter: `conversation_id=eq.${activeConv.conversation_id}`,
      }, (payload) => {
        const msg = payload.new as Message;
        setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
        // Stamp read (fire and forget) if message is from someone else
        if (msg.sender_email !== email) {
          authedFetch(`/api/chat/messages?conversation_id=${activeConv.conversation_id}`);
        }
      })
      .subscribe();
    msgChannelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [activeConv, email]);

  // Realtime: track when other person reads (for tick updates)
  useEffect(() => {
    if (!activeConv || !memberId) return;
    if (readChannelRef.current) supabase.removeChannel(readChannelRef.current);
    const ch = supabase
      .channel(`chat-read-${activeConv.conversation_id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "chat_participants",
        filter: `conversation_id=eq.${activeConv.conversation_id}`,
      }, (payload) => {
        // Update othersLastReadAt if it's not us who changed
        const updated = payload.new as { member_id: string; last_read_at: string };
        if (updated.member_id !== memberId) {
          setOthersLastReadAt((prev) =>
            !prev || updated.last_read_at > prev ? updated.last_read_at : prev
          );
        }
      })
      .subscribe();
    readChannelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [activeConv, memberId]);

  // ── Open a DM with a member (create if needed, then go straight in) ──

  const openDm = async (member: MemberOption) => {
    setOpeningDm(member.email);
    const res = await authedFetch("/api/chat/conversations", {
      method: "POST",
      body: JSON.stringify({ participant_emails: [member.email], is_group: false }),
    });
    const data = await res.json();
    if (!res.ok) { setOpeningDm(null); return; }

    // Build a local Conversation object immediately — don't wait for RPC
    const convObj: Conversation = {
      conversation_id: data.conversation_id,
      name: null,
      is_group: false,
      is_archived: false,
      updated_at: new Date().toISOString(),
      last_message: null,
      last_message_at: null,
      last_message_sender: null,
      unread_count: 0,
      participants: [{ member_id: member.id, name: member.display_name, email: member.email }],
    };

    setConversations((prev) => {
      const exists = prev.find((c) => c.conversation_id === data.conversation_id);
      if (exists) return prev;
      return [convObj, ...prev];
    });

    setSearch("");
    setActiveConv(convObj);
    setOpeningDm(null);
  };

  // ── Send message ────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!activeConv || !newMessage.trim() || sending) return;
    const content = newMessage.trim();
    setSending(true);
    setNewMessage("");
    const res = await authedFetch("/api/chat/messages", {
      method: "POST",
      body: JSON.stringify({ conversation_id: activeConv.conversation_id, content }),
    });
    if (!res.ok) setNewMessage(content); // restore on failure
    setSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Filtered data for the list ──────────────────────────────────

  const q = search.toLowerCase().trim();

  const filteredConvs = q
    ? conversations.filter((c) => convDisplayName(c).toLowerCase().includes(q))
    : conversations;

  // Members who DON'T have an existing conversation (or match the search)
  const existingEmails = new Set(
    conversations.flatMap((c) => c.participants?.map((p) => p.email) ?? [])
  );
  const filteredMembers = allMembers.filter((m) => {
    const matchesSearch = q ? (m.display_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)) : true;
    const noConversation = !existingEmails.has(m.email);
    return matchesSearch && (noConversation || q);
  });

  if (!email) return null;

  // ── Render ──────────────────────────────────────────────────────

  return (
    <>
      {/* ── Floating button ── */}
      <button
        onClick={onToggle}
        aria-label="Chat"
        style={{
          position: "fixed", bottom: 24, right: 24,
          width: 52, height: 52, borderRadius: "50%",
          background: NAVY, border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: SHADOWS.MODAL, zIndex: 1200,
          transition: "transform 0.15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill="white"/>
        </svg>
        {totalUnread > 0 && (
          <span style={{
            position: "absolute", top: 0, right: 0,
            minWidth: 18, height: 18, borderRadius: 999,
            background: "#B3261E", color: "#fff",
            fontSize: 10, fontWeight: 600,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 4px", border: "2px solid #fff",
          }}>
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>

      {/* ── Slide-in panel ── */}
      <div style={{
        position: "fixed", bottom: 88, right: 24,
        width: 340, maxWidth: "calc(100vw - 32px)",
        height: "min(580px, calc(100vh - 116px))",
        borderRadius: RADII.LG,
        background: CARD,
        border: `1px solid ${BORDER}`,
        boxShadow: SHADOWS.MODAL,
        zIndex: 1199,
        display: "flex", flexDirection: "column", overflow: "hidden",
        transform: isOpen ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? "auto" : "none",
        transition: "transform 0.18s ease, opacity 0.18s ease",
        transformOrigin: "bottom right",
      }}>

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "12px 14px",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}>
          {activeConv && (
            <button
              onClick={() => { setActiveConv(null); setMessages([]); setOthersLastReadAt(null); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: SLATE, padding: "2px 4px 2px 0", display: "flex" }}
              aria-label="Back"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
          {activeConv && (
            <div style={{
              width: 30, height: 30, borderRadius: "50%",
              background: avatarBg(activeConv.conversation_id),
              color: "#fff", fontSize: 11, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {initials(convDisplayName(activeConv))}
            </div>
          )}
          <span style={{
            fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600,
            color: NAVY, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {activeConv ? convDisplayName(activeConv) : "Messages"}
          </span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: SLATE, padding: 4, display: "flex" }}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── List view ── */}
        {!activeConv && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            {/* Search bar */}
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
              <div style={{ position: "relative" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: INK_400 }}>
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                  <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search or find someone…"
                  style={{
                    width: "100%", padding: "7px 10px 7px 28px",
                    border: `1px solid ${BORDER}`, borderRadius: RADII.PILL,
                    fontSize: 13, color: NAVY, background: CANVAS,
                    outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {loadingConvs && filteredConvs.length === 0 && filteredMembers.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: SLATE, fontSize: 13 }}>Loading…</div>
              ) : (
                <>
                  {/* Recent conversations */}
                  {filteredConvs.length > 0 && (
                    <>
                      {(q || filteredMembers.length > 0) && (
                        <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 600, color: INK_400, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          Recent
                        </div>
                      )}
                      {filteredConvs.map((conv) => (
                        <SwipeRow
                          key={conv.conversation_id}
                          leftBg={conv.is_archived ? COLOURS.GREEN : "#B4791F"}
                          leftLabel={conv.is_archived ? "↩ Unarchive" : "📁 Archive"}
                          rightBg={COLOURS.RED}
                          rightLabel="🗑 Delete"
                          onSwipeLeft={() => conversationAction(conv.conversation_id, conv.is_archived ? "unarchive" : "archive")}
                          onSwipeRight={() => conversationAction(conv.conversation_id, "delete")}
                          borderColor={BORDER}
                        >
                          <button
                            onClick={() => { setSearch(""); setActiveConv(conv); }}
                            style={{
                              display: "flex", alignItems: "center", gap: 10,
                              width: "100%", padding: "9px 14px",
                              background: "none", border: "none",
                              cursor: "pointer", textAlign: "left",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = CANVAS)}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                          >
                            <div style={{
                              width: 38, height: 38, borderRadius: "50%",
                              background: avatarBg(conv.conversation_id),
                              color: "#fff", fontSize: 13, fontWeight: 600,
                              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                              opacity: conv.is_archived ? 0.5 : 1,
                            }}>
                              {initials(convDisplayName(conv))}
                            </div>
                            <div style={{ flex: 1, overflow: "hidden" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 4 }}>
                                <span style={{ fontSize: 13, fontWeight: conv.unread_count > 0 ? 600 : 500, color: conv.is_archived ? SLATE : NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {convDisplayName(conv)}
                                  {conv.is_archived && <span style={{ fontSize: 10, color: INK_400, marginLeft: 6, fontWeight: 400 }}>Archived</span>}
                                </span>
                                <span style={{ fontSize: 10, color: INK_400, flexShrink: 0 }}>
                                  {timeLabel(conv.last_message_at)}
                                </span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, marginTop: 1 }}>
                                <span style={{
                                  fontSize: 11, color: conv.unread_count > 0 ? INK_700 : SLATE,
                                  fontWeight: conv.unread_count > 0 ? 500 : 400,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  {conv.last_message
                                    ? (conv.is_group && conv.last_message_sender
                                        ? `${conv.last_message_sender.split(" ")[0]}: ${conv.last_message}`
                                        : conv.last_message)
                                    : "No messages yet"}
                                </span>
                                {conv.unread_count > 0 && (
                                  <span style={{
                                    minWidth: 18, height: 18, borderRadius: 999,
                                    background: BLUE, color: "#fff",
                                    fontSize: 10, fontWeight: 600,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    padding: "0 4px", flexShrink: 0,
                                  }}>
                                    {conv.unread_count > 99 ? "99+" : conv.unread_count}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        </SwipeRow>
                      ))}
                    </>
                  )}

                  {/* People to start a new chat with */}
                  {filteredMembers.length > 0 && (
                    <>
                      <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 600, color: INK_400, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        {q ? "People" : "Start a chat"}
                      </div>
                      {filteredMembers.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => openDm(m)}
                          disabled={openingDm === m.email}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            width: "100%", padding: "9px 14px",
                            background: "none", border: "none",
                            borderBottom: `1px solid ${BORDER}`,
                            cursor: openingDm === m.email ? "wait" : "pointer",
                            textAlign: "left", opacity: openingDm === m.email ? 0.6 : 1,
                          }}
                          onMouseEnter={(e) => { if (!openingDm) e.currentTarget.style.background = CANVAS; }}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                        >
                          <div style={{
                            width: 38, height: 38, borderRadius: "50%",
                            background: avatarBg(m.id),
                            color: "#fff", fontSize: 13, fontWeight: 600,
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            {openingDm === m.email ? "…" : initials(m.display_name)}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500, color: NAVY }}>{m.display_name}</div>
                            <div style={{ fontSize: 11, color: SLATE }}>{m.role}{m.department ? ` · ${m.department}` : ""}</div>
                          </div>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Empty state */}
                  {filteredConvs.length === 0 && filteredMembers.length === 0 && !loadingConvs && (
                    <div style={{ padding: 32, textAlign: "center" }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
                      <div style={{ fontSize: 13, color: SLATE }}>
                        {q ? "No results found" : showArchived ? "No archived chats" : "No conversations yet"}
                      </div>
                      {!q && !showArchived && <div style={{ fontSize: 12, color: INK_400, marginTop: 4 }}>
                        Search for someone above to get started.
                      </div>}
                    </div>
                  )}

                  {/* Archived toggle */}
                  {!q && (
                    <button
                      onClick={() => {
                        const next = !showArchived;
                        setShowArchived(next);
                        loadConversations(next);
                      }}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                        width: "100%", padding: "10px 14px",
                        background: "none", border: "none", borderTop: showArchived ? `1px solid ${BORDER}` : "none",
                        cursor: "pointer", fontSize: 12, color: SLATE,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = NAVY)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = SLATE)}
                    >
                      📁 {showArchived ? "Hide archived chats" : "View archived chats"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Conversation view ── */}
        {activeConv && (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px 4px" }}>
              {hasMore && !loadingMore && (
                <div style={{ textAlign: "center", marginBottom: 8 }}>
                  <button
                    onClick={() => loadMessages(activeConv.conversation_id, messages[0]?.created_at)}
                    style={{
                      background: "none", border: `1px solid ${BORDER}`,
                      borderRadius: RADII.PILL, cursor: "pointer",
                      color: SLATE, fontSize: 11, padding: "4px 12px",
                    }}
                  >
                    Load earlier messages
                  </button>
                </div>
              )}
              {loadingMore && (
                <div style={{ textAlign: "center", fontSize: 11, color: SLATE, marginBottom: 8 }}>Loading…</div>
              )}

              {loadingMsgs ? (
                <div style={{ textAlign: "center", color: SLATE, fontSize: 13, padding: 24 }}>Loading…</div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: "center", padding: 32 }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>👋</div>
                  <div style={{ fontSize: 13, color: SLATE }}>
                    Start the conversation with {convDisplayName(activeConv)}
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isMe = msg.sender_email === email;
                  const prev = i > 0 ? messages[i - 1] : null;
                  const next = i < messages.length - 1 ? messages[i + 1] : null;

                  const showTimestamp = !prev ||
                    new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() > 15 * 60 * 1000;
                  const showSenderName = !isMe && activeConv.is_group &&
                    (!prev || prev.sender_email !== msg.sender_email || showTimestamp);
                  const isLastInGroup = !next || next.sender_email !== msg.sender_email;

                  // Is this the last message I sent? Show ticks on it.
                  const isRead = othersLastReadAt !== null &&
                    othersLastReadAt >= msg.created_at;
                  // Only show ticks on my last sent message (or all, up to you)
                  const showTicks = isMe;

                  return (
                    <div key={msg.id} style={{ marginBottom: 2 }}>
                      {showTimestamp && (
                        <div style={{ textAlign: "center", fontSize: 10, color: INK_400, margin: "8px 0 4px" }}>
                          {formatDateTimeUK(msg.created_at)}
                        </div>
                      )}
                      {showSenderName && (
                        <div style={{ fontSize: 10, color: SLATE, marginBottom: 2, marginLeft: 40 }}>
                          {msg.sender_name}
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", alignItems: "flex-end", gap: 6 }}>
                        {/* Other person avatar (only on last in group) */}
                        {!isMe && (
                          <div style={{
                            width: 26, height: 26, borderRadius: "50%",
                            background: isLastInGroup ? avatarBg(msg.sender_email) : "transparent",
                            color: "#fff", fontSize: 9, fontWeight: 600,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}>
                            {isLastInGroup ? initials(msg.sender_name) : ""}
                          </div>
                        )}

                        <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start" }}>
                          <div style={{
                            padding: "8px 11px",
                            borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                            background: isMe ? NAVY : CANVAS,
                            color: isMe ? "#fff" : NAVY,
                            fontSize: 13, lineHeight: 1.45,
                            wordBreak: "break-word",
                            border: isMe ? "none" : `1px solid ${BORDER}`,
                          }}>
                            {msg.content}
                          </div>
                          {/* Ticks on sent messages */}
                          {showTicks && (
                            <div style={{ marginTop: 2, marginRight: 2 }}>
                              <Ticks read={isRead} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: "8px 10px",
              borderTop: `1px solid ${BORDER}`,
              display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0,
            }}>
              <textarea
                ref={inputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message…"
                rows={1}
                maxLength={2000}
                style={{
                  flex: 1, padding: "8px 10px",
                  border: `1px solid ${BORDER}`, borderRadius: 20,
                  fontSize: 13, color: NAVY, background: CANVAS,
                  outline: "none", resize: "none",
                  fontFamily: "var(--font-sans)", lineHeight: 1.4,
                  maxHeight: 80, overflowY: "auto",
                }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 80)}px`;
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!newMessage.trim() || sending}
                style={{
                  width: 36, height: 36, borderRadius: "50%",
                  background: newMessage.trim() && !sending ? NAVY : INK_300,
                  border: "none",
                  cursor: newMessage.trim() && !sending ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, transition: "background 0.15s",
                }}
                aria-label="Send"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
