import { describe, expect, it } from "vitest";
import { extractRoomMembersMessage } from "./useGameSocket";

/**
 * `t:'room_members'` payload extraction. The canonical wire field is
 * `room_members`; a legacy `members` field is still accepted because a past
 * server/client skew sent one while the other read the other — which left
 * the UI stuck on "Loading members…" forever.
 */
describe("extractRoomMembersMessage", () => {
  it("extracts the canonical room_members field", () => {
    const out = extractRoomMembersMessage({
      t: "room_members",
      roomId: 7,
      room_members: [
        { player_id: 1, username: "alice", role: "owner", online: true },
        { player_id: 2, username: "bob", role: "member", muted_until: 0 },
      ],
    });
    expect(out?.roomId).toBe("7");
    expect(out?.members).toHaveLength(2);
    expect(out?.members[0]).toMatchObject({ id: 1, username: "alice", isOwner: true, online: true });
    expect(out?.members[1]).toMatchObject({ id: 2, username: "bob", isOwner: false });
  });

  it("accepts the legacy members field", () => {
    const out = extractRoomMembersMessage({
      t: "room_members",
      roomId: "9",
      members: [{ player_id: 3, username: "zara", role: "member" }],
    });
    expect(out?.roomId).toBe("9");
    expect(out?.members).toHaveLength(1);
    expect(out?.members[0].username).toBe("zara");
  });

  it("prefers room_members when both fields are present", () => {
    const out = extractRoomMembersMessage({
      t: "room_members",
      roomId: 1,
      room_members: [{ player_id: 1, username: "canon" }],
      members: [{ player_id: 2, username: "legacy" }],
    });
    expect(out?.members).toHaveLength(1);
    expect(out?.members[0].username).toBe("canon");
  });

  it("returns null when neither field is present", () => {
    expect(extractRoomMembersMessage({ t: "room_members", roomId: 1 })).toBeNull();
  });

  it("returns null when roomId is missing", () => {
    expect(
      extractRoomMembersMessage({ t: "room_members", room_members: [] })
    ).toBeNull();
  });

  it("filters out unusable entries instead of failing the whole list", () => {
    const out = extractRoomMembersMessage({
      t: "room_members",
      roomId: 2,
      room_members: [{ player_id: 1, username: "ok" }, { nope: true }, null],
    });
    expect(out?.members).toHaveLength(1);
    expect(out?.members[0].username).toBe("ok");
  });

  it("treats a non-array payload as an empty list", () => {
    const out = extractRoomMembersMessage({
      t: "room_members",
      roomId: 2,
      room_members: "garbage",
    });
    expect(out?.members).toEqual([]);
  });
});
