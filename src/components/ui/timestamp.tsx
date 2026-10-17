"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

const utcText = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * UTC on the server and on first paint, then the reader's local time with UTC
 * alongside once mounted, so hydration never disagrees about the time zone.
 */
export function Timestamp({ value, className }: { value: string; className?: string }) {
  const date = new Date(value);
  // false during server render and hydration, true afterwards.
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false
  );
  if (Number.isNaN(date.getTime())) return <span className={className}>Unknown</span>;
  const local = mounted
    ? date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : null;
  return (
    <time dateTime={value} className={className} title={date.toISOString()}>
      {local ? (
        <>
          {local} <span className="text-muted-foreground">({utcText(date)})</span>
        </>
      ) : (
        utcText(date)
      )}
    </time>
  );
}
