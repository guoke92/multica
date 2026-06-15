"use client";

import { useParams } from "next/navigation";
import { RoomsPage } from "@multica/views/room";

export default function Page() {
  const params = useParams();
  const roomId = typeof params.roomId === "string" ? params.roomId : undefined;
  return <RoomsPage roomId={roomId} />;
}
