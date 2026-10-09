import { useState } from "react";
import { Button, Dialog, Sheet, useToast } from "../../components";
import type { GameSocket } from "../../hooks/useGameSocket";

export interface ProfileTarget {
  playerId: number | null;
  username: string;
}

const REPORT_REASONS = ["Spam", "Harassment", "Scam", "Inappropriate content", "Other"];

/**
 * Player profile sheet — opened by tapping a username in chat, rooms, or DMs.
 * Actions: add friend, start DM, block/unblock, report.
 */
export function ProfileSheet({
  open,
  target,
  youId,
  sock,
  onClose,
  onStartDm,
}: {
  open: boolean;
  target: ProfileTarget | null;
  youId: number;
  sock: GameSocket;
  onClose: () => void;
  onStartDm: (playerId: number, username: string) => void;
}) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<"block" | "unblock" | "report" | "removeFriend" | null>(null);
  const [reason, setReason] = useState(REPORT_REASONS[0]);

  if (!target) return null;
  const isSelf = target.playerId === youId;
  const pid = target.playerId;
  const blocked = pid !== null && sock.isBlocked(pid);
  const friend = pid !== null && sock.isFriend(pid);
  const onlinePlayer = pid !== null ? sock.players.find((p) => p.id === pid) : undefined;
  const onlineFriend = pid !== null ? sock.friends.find((f) => f.id === pid) : undefined;

  const closeAll = () => {
    setConfirm(null);
    onClose();
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} label={`@${target.username}`}>
        <div className="eko-profile">
          <div className="eko-profile__head">
            <span className="eko-profile__avatar" aria-hidden="true">
              {target.username.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong className="eko-profile__name">@{target.username}</strong>
              {(onlinePlayer || onlineFriend?.online) && (
                <span className="eko-profile__online">
                  <span className="eko-dot" aria-hidden="true" /> Online now
                </span>
              )}
            </div>
          </div>

          {!isSelf && pid !== null && (
            <div className="eko-profile__actions">
              {!friend && !blocked && (
                <Button
                  size="lg"
                  variant="accent"
                  onClick={() => {
                    sock.addFriend(target.username);
                    toast(`🤝 Friend request sent to @${target.username}`, "success");
                    closeAll();
                  }}
                  className="eko-profile__btn"
                >
                  🤝 Add friend
                </Button>
              )}
              {friend && (
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => setConfirm("removeFriend")}
                  className="eko-profile__btn"
                >
                  💔 Remove friend
                </Button>
              )}
              {!blocked && (
                <Button
                  size="lg"
                  onClick={() => onStartDm(pid, target.username)}
                  className="eko-profile__btn"
                >
                  💬 Message
                </Button>
              )}
              {blocked ? (
                <Button
                  size="lg"
                  variant="accent"
                  onClick={() => setConfirm("unblock")}
                  className="eko-profile__btn"
                >
                  ✅ Unblock @{target.username}
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => setConfirm("block")}
                  className="eko-profile__btn"
                >
                  🚫 Block
                </Button>
              )}
              {!blocked && (
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => setConfirm("report")}
                  className="eko-profile__btn"
                >
                  ⚠️ Report
                </Button>
              )}
            </div>
          )}
          {isSelf && <p className="eko-profile__note">That's you — looking sharp.</p>}
          {blocked && (
            <p className="eko-profile__note">
              🚫 @{target.username} is blocked. You won't see their messages.
            </p>
          )}
        </div>
      </Sheet>

      {/* Block / unblock confirm */}
      <Dialog
        open={confirm === "block" || confirm === "unblock"}
        onClose={() => setConfirm(null)}
        title={confirm === "block" ? "Block player?" : "Unblock player?"}
      >
        <p className="eko-profile__dialog-text">
          {confirm === "block" ? (
            <>
              Blocking <strong>@{target.username}</strong> hides all their
              messages from you, in city chat, rooms, and DMs.
            </>
          ) : (
            <>
              Unblock <strong>@{target.username}</strong>? You'll see their
              messages again.
            </>
          )}
        </p>
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (pid === null) return;
              if (confirm === "block") {
                sock.blockUser(pid, target.username);
                toast(`🚫 @${target.username} blocked`, "info");
              } else {
                sock.unblockUser(pid);
                toast(`✅ @${target.username} unblocked`, "success");
              }
              closeAll();
            }}
          >
            {confirm === "block" ? "Block" : "Unblock"}
          </Button>
        </div>
      </Dialog>

      {/* Remove friend confirm */}
      <Dialog
        open={confirm === "removeFriend"}
        onClose={() => setConfirm(null)}
        title="Remove friend?"
      >
        <p className="eko-profile__dialog-text">
          Remove <strong>@{target.username}</strong> from your friends? You can
          add them back any time.
        </p>
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (pid === null) return;
              sock.removeFriend(pid);
              toast(`💔 Removed @${target.username}`, "info");
              closeAll();
            }}
          >
            Remove
          </Button>
        </div>
      </Dialog>

      {/* Report dialog */}
      <Dialog
        open={confirm === "report"}
        onClose={() => setConfirm(null)}
        title={`Report @${target.username}`}
      >
        <p className="eko-profile__dialog-text">
          Reports go to the city moderators. Choose what fits best:
        </p>
        <div className="eko-profile__reasons">
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className={`eko-profile__reason ${reason === r ? "eko-profile__reason--active" : ""}`}
              onClick={() => setReason(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (pid === null) return;
              sock.reportUser(pid, reason);
              toast("⚠️ Report sent. The moderators will take a look.", "success");
              closeAll();
            }}
          >
            Send report
          </Button>
        </div>
      </Dialog>
    </>
  );
}
