"use client";

type Props = {
  text: string;
};

/** v2.3: lightweight attribution on agent reply slots — not a standalone system row. */
export function RoomAttributionPill({ text }: Props) {
  return (
    <span className="bg-primary/10 text-primary inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium">
      {text}
    </span>
  );
}
