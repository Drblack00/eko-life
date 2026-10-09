import { Button, EmptyState } from "../components";
import { clearSession, getUsername } from "../lib/auth";
import "./ComingSoon.css";

/** Post-auth placeholder — character creation ships in M2. */
export function ComingSoon({
  username,
  onSignOut,
}: {
  username: string;
  onSignOut: () => void;
}) {
  const name = username || getUsername() || "traveller";
  return (
    <div className="eko-soon">
      <EmptyState
        emoji="🌅"
        title="Your journey begins soon"
        body={`Welcome to Èkó Life, ${name}. Character creation opens in Milestone 2 — your session is saved and ready.`}
        action={
          <div className="eko-soon__actions">
            <Button variant="ghost" onClick={onSignOut}>
              Sign out
            </Button>
          </div>
        }
      />
      <button
        type="button"
        className="eko-soon__link"
        onClick={() => {
          clearSession();
          onSignOut();
        }}
      >
        Not {name}? Switch account
      </button>
    </div>
  );
}
