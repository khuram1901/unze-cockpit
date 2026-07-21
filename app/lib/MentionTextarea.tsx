"use client";

/**
 * MentionTextarea
 *
 * A textarea that detects "@" and opens a filtered member dropdown.
 * When a member is selected:
 *   - "@Name" is inserted into the text at the cursor position
 *   - onMentionAdded(member) is called so the parent can add them as an assignee
 *
 * The dropdown is positioned relative to the textarea wrapper using a fixed
 * offset — not absolute-to-cursor, since that requires measuring the caret
 * pixel position which is unreliable cross-browser without a hidden mirror div.
 * The dropdown appears just below the textarea instead (clean and reliable).
 *
 * Props mirror a standard <textarea> so it can be a drop-in replacement:
 *   value, onChange, placeholder, style, rows, required
 * Plus:
 *   members      — list of { id, name, email, department } to mention
 *   onMentionAdded(member) — called when a mention is committed
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { COLOURS, RADII } from "./SharedUI";

export type MentionMember = {
  id: string;
  name: string;
  email: string | null;
  department: string | null;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  members: MentionMember[];
  onMentionAdded: (member: MentionMember) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  rows?: number;
  required?: boolean;
  maxLength?: number;
};

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

const AVATAR_COLOURS = [
  { bg: "#E8EDFF", text: "#3B4CCA" },
  { bg: "#E7F2ED", text: "#0F7B5F" },
  { bg: "#FBF1DE", text: "#B4791F" },
  { bg: "#F3EEF9", text: "#6E45B8" },
  { bg: "#F8E4E2", text: "#B3261E" },
];

function avatarColour(name: string) {
  const idx = name.charCodeAt(0) % AVATAR_COLOURS.length;
  return AVATAR_COLOURS[idx];
}

export default function MentionTextarea({
  value,
  onChange,
  members,
  onMentionAdded,
  placeholder,
  style,
  rows = 3,
  required,
  maxLength,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // mentionQuery: the text after "@" if we're in an active mention, else null
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // cursorAtMentionStart: the textarea selectionStart position of the "@" char
  const cursorAtMentionStartRef = useRef<number>(-1);
  const [dropdownIndex, setDropdownIndex] = useState(0);

  const filteredMembers =
    mentionQuery !== null
      ? members.filter((m) =>
          m.name.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      : [];

  // Scan backwards from cursor to detect an active @mention
  function detectMention(text: string, cursor: number): string | null {
    // Walk backwards from cursor, collecting characters until we hit a space,
    // newline, or the start of the string. If we hit "@" first, we're in a mention.
    let i = cursor - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "@") return text.slice(i + 1, cursor);
      if (ch === " " || ch === "\n") return null;
      i--;
    }
    return null;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newVal = maxLength ? e.target.value.slice(0, maxLength) : e.target.value;
    onChange(newVal);

    const cursor = e.target.selectionStart ?? newVal.length;
    const query = detectMention(newVal, cursor);
    setMentionQuery(query);
    if (query !== null && cursorAtMentionStartRef.current === -1) {
      // Record where the "@" starts — cursor - query.length - 1
      cursorAtMentionStartRef.current = cursor - query.length - 1;
    }
    if (query === null) {
      cursorAtMentionStartRef.current = -1;
    }
    setDropdownIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery === null || filteredMembers.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDropdownIndex((prev) => Math.min(prev + 1, filteredMembers.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDropdownIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commitMention(filteredMembers[dropdownIndex]);
    } else if (e.key === "Escape") {
      setMentionQuery(null);
      cursorAtMentionStartRef.current = -1;
    }
  }

  const commitMention = useCallback(
    (member: MentionMember) => {
      const ta = textareaRef.current;
      if (!ta) return;

      const atPos = cursorAtMentionStartRef.current;
      if (atPos === -1) return;

      // Replace "@<query>" with "@Name " in the textarea value
      const before = value.slice(0, atPos);
      const cursor = ta.selectionStart ?? value.length;
      const after = value.slice(cursor); // text after the query
      const inserted = `@${member.name} `;
      const newVal = before + inserted + after;
      onChange(newVal);

      // Reset mention state
      setMentionQuery(null);
      cursorAtMentionStartRef.current = -1;
      setDropdownIndex(0);

      // Notify parent to add this member as an assignee
      onMentionAdded(member);

      // Restore focus + move cursor to after the inserted mention
      requestAnimationFrame(() => {
        if (ta) {
          ta.focus();
          const newCursor = atPos + inserted.length;
          ta.setSelectionRange(newCursor, newCursor);
        }
      });
    },
    [value, onChange, onMentionAdded]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMentionQuery(null);
        cursorAtMentionStartRef.current = -1;
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const showDropdown = mentionQuery !== null && filteredMembers.length > 0;

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        required={required}
        maxLength={maxLength}
        style={style}
      />

      {showDropdown && (
        <div
          role="listbox"
          aria-label="Mention a team member"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 200,
            backgroundColor: COLOURS.CARD,
            border: `1px solid ${COLOURS.HAIRLINE}`,
            borderRadius: RADII.CARD,
            boxShadow: "0 8px 30px rgba(15,23,32,0.12)",
            marginTop: "4px",
            overflow: "hidden",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              padding: "6px 10px 4px",
              fontSize: "10.5px",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: COLOURS.SLATE,
              borderBottom: `1px solid ${COLOURS.HAIRLINE}`,
            }}
          >
            {mentionQuery ? `Members matching "${mentionQuery}"` : "All members"}
          </div>

          {filteredMembers.map((m, i) => {
            const av = avatarColour(m.name);
            const isActive = i === dropdownIndex;
            return (
              <div
                key={m.id}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep textarea focus
                  setDropdownIndex(i);
                  commitMention(m);
                }}
                onMouseEnter={() => setDropdownIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  backgroundColor: isActive ? COLOURS.CARD_ALT : COLOURS.CARD,
                  borderBottom: i < filteredMembers.length - 1 ? `1px solid ${COLOURS.HAIRLINE}` : "none",
                  transition: "background-color 0.1s",
                }}
              >
                {/* Avatar */}
                <div
                  aria-hidden="true"
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    backgroundColor: av.bg,
                    color: av.text,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {initials(m.name)}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: COLOURS.NAVY, lineHeight: 1.3 }}>
                    {m.name}
                  </div>
                  {m.department && (
                    <div style={{ fontSize: "11px", color: COLOURS.SLATE, lineHeight: 1.2 }}>
                      {m.department}
                    </div>
                  )}
                </div>

                {isActive && (
                  <div
                    style={{
                      marginLeft: "auto",
                      fontSize: "10.5px",
                      color: COLOURS.SLATE,
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    ↵
                  </div>
                )}
              </div>
            );
          })}

          {filteredMembers.length === 0 && mentionQuery && (
            <div style={{ padding: "10px 12px", fontSize: "13px", color: COLOURS.SLATE, fontStyle: "italic" }}>
              No members found for &ldquo;{mentionQuery}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
