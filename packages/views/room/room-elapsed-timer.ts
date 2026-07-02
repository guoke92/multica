"use client";

import { useEffect, useMemo, useState } from "react";

const waitAnchors = new Map<string, number>();

export function waitAnchorMs(key: string, createdAt?: string): number {
  const existing = waitAnchors.get(key);
  if (existing !== undefined) return existing;
  const parsed = createdAt ? Date.parse(createdAt) : NaN;
  const anchor = Number.isFinite(parsed) ? parsed : Date.now();
  waitAnchors.set(key, anchor);
  return anchor;
}

/** Live elapsed seconds from a stable anchor — matches chat invocation timers. */
export function useElapsedSeconds(anchorKey: string, createdAt?: string): number | null {
  const anchor = useMemo(
    () => waitAnchorMs(anchorKey, createdAt),
    [anchorKey, createdAt],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!createdAt) return null;
  return Math.max(0, Math.floor((now - anchor) / 1000));
}

export function elapsedSecondsBetween(
  startAt?: string,
  endAt?: string,
): number | null {
  if (!startAt || !endAt) return null;
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function formatElapsedSeconds(seconds: number): string {
  return `${seconds}s`;
}

export function formatFlowClockTime(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}
