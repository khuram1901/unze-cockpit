import React from "react";
import { COLOURS } from "./SharedUI";

// Detects http/https URLs in a string and renders them as clickable links.
// Everything else is rendered as plain text. Line breaks are preserved.
// Used anywhere user-entered text is displayed: comments, notes, reply text, etc.
export function renderWithLinks(text: string | null | undefined): React.ReactNode {
  if (!text) return null;

  const urlRegex = /https?:\/\/[^\s<>"']+/g;
  const lines = text.split("\n");

  return lines.map((line, lineIdx) => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    urlRegex.lastIndex = 0;

    while ((match = urlRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.slice(lastIndex, match.index));
      }
      const url = match[0];
      // Strip trailing punctuation that's likely not part of the URL
      const cleanUrl = url.replace(/[.,;:!?)]+$/, "");
      const trailing = url.slice(cleanUrl.length);
      parts.push(
        <a
          key={`link-${lineIdx}-${match.index}`}
          href={cleanUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: COLOURS.GREEN, textDecoration: "underline", wordBreak: "break-all" }}
        >
          {cleanUrl}
        </a>
      );
      if (trailing) parts.push(trailing);
      lastIndex = match.index + url.length;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }

    return (
      <React.Fragment key={`line-${lineIdx}`}>
        {parts}
        {lineIdx < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}
