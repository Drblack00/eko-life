import { describe, expect, it } from "vitest";
import { resolveRoomMembersView } from "./RoomsView";
import type { RoomMember } from "../../game/types";

const ALICE: RoomMember = { id: 1, username: "alice", online: true, isOwner: true };
const BOB: RoomMember = { id: 2, username: "bob", online: false };

/**
 * Chat -> Rooms -> room thread member list must never sit on an infinite
 * spinner: loading / error-with-retry / empty / list are distinct states.
 */
describe("resolveRoomMembersView", () => {
  it("shows loading before the first fetch resolves", () => {
    expect(resolveRoomMembersView(undefined, "loading")).toEqual({ kind: "loading" });
    expect(resolveRoomMembersView(undefined, undefined)).toEqual({ kind: "loading" });
  });

  it("shows an error (with retry) when the server stays silent, not infinite loading", () => {
    expect(resolveRoomMembersView(undefined, "error")).toEqual({ kind: "error" });
    // Even with stale cached members, the error state must surface so the
    // user gets a retry button instead of a silently stale list.
    expect(resolveRoomMembersView([ALICE], "error")).toEqual({ kind: "error" });
  });

  it("shows an empty state when the room has loaded with no members", () => {
    expect(resolveRoomMembersView([], "loaded")).toEqual({ kind: "empty" });
  });

  it("lists members once loaded", () => {
    const view = resolveRoomMembersView([ALICE, BOB], "loaded");
    expect(view).toEqual({ kind: "list", members: [ALICE, BOB] });
  });

  it("lists members pushed by the server even before an explicit request", () => {
    // The server broadcasts room_members on join/leave/kick, which can
    // arrive without a requestRoomMembers round-trip (status undefined).
    const view = resolveRoomMembersView([ALICE], undefined);
    expect(view).toEqual({ kind: "list", members: [ALICE] });
  });

  it("keeps showing stale members while a retry is in flight", () => {
    const view = resolveRoomMembersView([ALICE], "loading");
    expect(view).toEqual({ kind: "list", members: [ALICE] });
  });

  it("does not mistake an empty-but-not-yet-loaded list for the empty state", () => {
    expect(resolveRoomMembersView([], "loading").kind).toBe("loading");
    expect(resolveRoomMembersView([], undefined).kind).toBe("loading");
  });
});
