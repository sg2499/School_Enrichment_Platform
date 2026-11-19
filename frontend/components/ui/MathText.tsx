import { Fragment } from "react";

/**
 * Shows plain text with powers written as small raised numbers: 2^3 -> 2³,
 * 10^-2, (a+b)^2, x^(n+1). Everything else is left exactly as written, so it
 * is safe to put around any question, option, hint or answer (#244).
 */
const POWER = /\^(\([^()]{1,12}\)|[-+]?[0-9A-Za-z]{1,6})/g;

export function MathText({ children }: { children: string | null | undefined }) {
  const text = children ?? "";
  if (!text.includes("^")) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(POWER)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(<Fragment key={key++}>{text.slice(last, index)}</Fragment>);
    const raw = match[1];
    const exponent = raw.startsWith("(") ? raw.slice(1, -1) : raw;
    parts.push(<sup key={key++}>{exponent}</sup>);
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}
