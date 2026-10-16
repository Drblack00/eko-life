import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, asList, type CityInfo, type ClassInfo } from "../lib/api";
import {
  AVATAR_LOOK_DEFAULTS,
  AVATAR_LOOK_FALLBACK_OPTIONS,
  sanitizeAvatarLook,
  type AvatarLook,
  type AvatarLookOptions,
} from "../game/types";
import { AvatarStudio } from "./avatar/AvatarStudio";
import { CityPicker } from "./CityPicker";
import { CreateStepper, type CreateStep } from "./CreateStepper";
import { Button, Card, Skeleton, useToast } from "../components";
import { markCloudSaveDirty } from "../lib/cloudSave";
import "./CreateCharacter.css";
import "./CityPicker.css";
import "./CreateStepper.css";

/**
 * M2 character creation — 3 separate pages (city-flow-b mockup):
 *   Page 1: name + style → Page 2: state (standalone) → Page 3: avatar.
 * POST /api/characters {name, class, avatar, color} — once per character.
 * Avatar/color options are a subset of the server allowlists (server/src/game/data.js),
 * so they always pass server validation.
 */
const AVATARS = ["🧑", "👩", "👨", "🧔", "👩‍🦱", "🧕", "🤠", "😎"];
const COLORS = [
  "#22d3ee",
  "#f472b6",
  "#a3e635",
  "#fbbf24",
  "#c084fc",
  "#fb7185",
  "#34d399",
  "#60a5fa",
];

function classOrder(classes: Record<string, ClassInfo>): ClassInfo[] {
  const list = asList(classes);
  const rank = (id: string) =>
    id === "silver_spoon" ? 0 : id === "street_smart" ? 1 : 2;
  return list.slice().sort((a, b) => rank(a.id) - rank(b.id));
}

export function CreateCharacter({
  token,
  username,
  onDone,
  onSignOut,
}: {
  token: string;
  username: string;
  onDone: () => void;
  onSignOut: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<CreateStep>(1);
  const [classes, setClasses] = useState<ClassInfo[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState(username);
  const [classId, setClassId] = useState("street_smart");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [avatarOpts, setAvatarOpts] = useState<string[]>(AVATARS);
  const [colorOpts, setColorOpts] = useState<string[]>(COLORS);
  // M15: 3D look — options from /api/config, local fallback until the
  // server serves avatarLook; the staged look is saved on submit only.
  const [lookOpts, setLookOpts] = useState<AvatarLookOptions | null>(null);
  const [look, setLook] = useState<AvatarLook>(AVATAR_LOOK_DEFAULTS);
  // Home City V1: playable cities from /api/config. Starts UNSELECTED so
  // the player makes a deliberate choice; 'lagos' is the safety fallback
  // only when the endpoint fails or returns no cities.
  const [cities, setCities] = useState<CityInfo[]>([]);
  const [cityId, setCityId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [endpointMissing, setEndpointMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((cfg) => {
        if (cancelled) return;
        const list = classOrder(cfg.classes ?? {});
        if (list.length === 0) {
          setLoadError("The city didn't send any character classes.");
        } else {
          setClasses(list);
          if (!list.some((c) => c.id === classId)) setClassId(list[0].id);
        }
        // Prefer server allowlists for avatar/color (fall back to local subsets).
        if (Array.isArray(cfg.avatars) && cfg.avatars.length > 0) {
          setAvatarOpts(cfg.avatars);
          if (!cfg.avatars.includes(avatar)) setAvatar(cfg.avatars[0]);
        }
        if (Array.isArray(cfg.colors) && cfg.colors.length > 0) {
          setColorOpts(cfg.colors);
          if (!cfg.colors.includes(color)) setColor(cfg.colors[0]);
        }
        // Home City V1: city summaries from the server (array or keyed
        // object). No pre-selection — the player picks on page 2.
        // 'lagos' fallback only when the server sends none.
        const cityList = asList(cfg.cities);
        if (cityList.length > 0) {
          setCities(cityList);
        } else {
          setCityId("lagos");
        }
        // M15: prefer the server's avatar option lists (fall back to local).
        const serverLook = cfg.avatarLook;
        if (
          serverLook &&
          Array.isArray(serverLook.bodies) &&
          serverLook.bodies.length > 0 &&
          serverLook.defaults &&
          typeof serverLook.defaults === "object"
        ) {
          setLookOpts(serverLook);
          setLook(sanitizeAvatarLook(serverLook.defaults, serverLook));
        } else {
          setLookOpts(AVATAR_LOOK_FALLBACK_OPTIONS);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // Safety fallback so creation can never hard-block on cities.
        setCityId("lagos");
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "Couldn't reach the city. Check your connection."
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Name rules must match the server's USER_RE (server/src/auth.js): no spaces. */
  const validateName = (): boolean => {
    const clean = name.trim();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(clean)) {
      setNameError("3–16 letters, numbers or underscores.");
      return false;
    }
    setNameError("");
    return true;
  };

  const submit = async () => {
    setSubmitError("");
    setEndpointMissing(false);
    if (!validateName()) return;
    const clean = name.trim();
    setBusy(true);
    const cityName =
      cities.find((c) => c.id === cityId)?.name ?? "Lagos";
    try {
      await api.createCharacter(token, {
        name: clean,
        class: classId,
        avatar,
        color,
        avatar_look: sanitizeAvatarLook(look, lookOpts ?? undefined),
        city: cityId ?? "lagos",
      });
      try {
        localStorage.setItem(`eko_char_done:${username}`, "1");
      } catch {
        /* private mode: creation just re-asks next session */
      }
      markCloudSaveDirty();
      toast(`Your ${cityName} story begins, ${clean}!`, "success");
      onDone();
    } catch (err) {
      setBusy(false);
      if (
        err instanceof ApiError &&
        (err.status === 409 ||
          (err.status === 400 && /already created/i.test(err.message)))
      ) {
        // Already created (one-time endpoint) — proceed into the game.
        try {
          localStorage.setItem(`eko_char_done:${username}`, "1");
        } catch {
          /* ignore */
        }
        markCloudSaveDirty();
        onDone();
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        // M2 server not deployed yet — offer a way forward.
        setEndpointMissing(true);
        return;
      }
      setSubmitError(
        err instanceof ApiError
          ? err.message
          : "Couldn't create your character. Check your connection and try again."
      );
    }
  };

  /** Enter key / form submit advances or finishes depending on the page. */
  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step === 1) {
      if (validateName()) setStep(2);
      return;
    }
    if (step === 2) {
      if (cityId) setStep(3);
      return;
    }
    void submit();
  };

  const selectedClass = classes?.find((c) => c.id === classId);
  const selectedCityName =
    cities.find((c) => c.id === cityId)?.name ?? "Lagos";

  return (
    <div className="eko-create">
      <header className="eko-create__top">
        <span className="eko-create__wordmark">Èkó Life</span>
        <button
          type="button"
          className="eko-create__signout"
          onClick={onSignOut}
        >
          Sign out
        </button>
      </header>

      {loadError ? (
        <main className="eko-create__main">
          <Card>
            <p className="eko-create__error" role="alert">
              {loadError}
            </p>
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </Card>
        </main>
      ) : !classes ? (
        <main className="eko-create__main">
          <div className="eko-create__loading" aria-label="Loading character options">
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={56} />
          </div>
        </main>
      ) : (
        <form
          onSubmit={handleFormSubmit}
          noValidate
          className="eko-create__form"
        >
          <main className="eko-create__main">
            <CreateStepper
              step={step}
              onBack={
                step === 2 ? () => setStep(1) : step === 3 ? () => setStep(2) : undefined
              }
            />

            {step === 1 && (
              <>
                <h1 className="eko-create__title">Who are you?</h1>
                <p className="eko-create__sub">
                  Pick a name and a background. Your style shapes your hustle.
                </p>
                <section>
                  <input
                    className="eko-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={16}
                    placeholder="e.g. Adaeze"
                    aria-label="Your name"
                    aria-invalid={!!nameError}
                    aria-describedby={nameError ? "cc-name-error" : undefined}
                  />
                  {nameError && (
                    <p id="cc-name-error" className="eko-field__error" role="alert">
                      {nameError}
                    </p>
                  )}
                </section>

                <section aria-labelledby="cc-class">
                  <h2 id="cc-class" className="eko-create__h2">
                    Pick your style
                  </h2>
                  <div className="eko-create__classes" role="radiogroup" aria-label="Character class">
                    {classes.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={classId === c.id}
                        className={`eko-create__class glass ${classId === c.id ? "eko-create__class--active" : ""}`}
                        onClick={() => setClassId(c.id)}
                      >
                        <span className="eko-create__class-icon" aria-hidden="true">
                          {c.icon}
                        </span>
                        <span className="eko-create__class-body">
                          <span className="eko-create__class-name">{c.name}</span>
                          <span className="eko-create__class-tagline">{c.tagline}</span>
                          <ul className="eko-create__perks">
                            {c.perks.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        </span>
                        <span
                          className="eko-create__class-check"
                          aria-hidden="true"
                        >
                          {classId === c.id ? "●" : "○"}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="eko-create__title">Choose your state</h1>
                <p className="eko-create__sub">
                  Your hustle starts somewhere. Where's home?
                </p>
                {cities.length > 0 ? (
                  <CityPicker
                    cities={cities}
                    selectedId={cityId}
                    onSelect={setCityId}
                  />
                ) : (
                  <p className="eko-create__3dnote">
                    Couldn't load the states — you'll start in Lagos.
                  </p>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <h1 className="eko-create__title">Choose your look</h1>
                <p className="eko-create__sub">
                  This is how the streets will see you.
                </p>
                <section aria-labelledby="cc-look">
                  <h2 id="cc-look" className="eko-create__h2">
                    Your look
                  </h2>
                  <div className="eko-create__preview glass">
                    <span
                      className="eko-create__preview-dot"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    >
                      <span className="eko-create__preview-emoji">{avatar}</span>
                    </span>
                    <span className="eko-create__preview-name">
                      {name.trim() || "Your name"}
                      {selectedClass ? ` · ${selectedClass.name}` : ""}
                    </span>
                  </div>
                  <div
                    className="eko-create__avatars"
                    role="radiogroup"
                    aria-label="Avatar"
                  >
                    {avatarOpts.map((a) => (
                      <button
                        key={a}
                        type="button"
                        role="radio"
                        aria-checked={avatar === a}
                        aria-label={`Avatar ${a}`}
                        className={`eko-create__avatar ${avatar === a ? "eko-create__avatar--active" : ""}`}
                        onClick={() => setAvatar(a)}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                  <div
                    className="eko-create__colors"
                    role="radiogroup"
                    aria-label="Colour"
                  >
                    {colorOpts.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={color === c}
                        aria-label={`Colour ${c}`}
                        className={`eko-create__color ${color === c ? "eko-create__color--active" : ""}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setColor(c)}
                      />
                    ))}
                  </div>
                </section>

                <section aria-labelledby="cc-3dlook">
                  <h2 id="cc-3dlook" className="eko-create__h2">
                    Your 3D look
                  </h2>
                  <p className="eko-create__3dnote">
                    Spin it, style it — this is how you'll appear in 3D scenes.
                    Your emoji above stays as your chat icon.
                  </p>
                  {lookOpts ? (
                    <AvatarStudio
                      compact
                      initial={look}
                      options={lookOpts}
                      onSave={setLook}
                    />
                  ) : (
                    <div
                      className="eko-create__loading"
                      aria-label="Loading 3D look options"
                    >
                      <Skeleton height={220} />
                      <Skeleton height={48} />
                      <Skeleton height={48} />
                    </div>
                  )}
                </section>

                {submitError && (
                  <p className="eko-create__error" role="alert">
                    {submitError}
                  </p>
                )}

                {endpointMissing && (
                  <Card className="eko-create__fallback">
                    <p>
                      Character creation isn't live on this server yet — your
                      default character is ready instead.
                    </p>
                    <Button type="button" onClick={onDone}>
                      Enter the city with my default character
                    </Button>
                  </Card>
                )}
              </>
            )}
          </main>

          <footer className="eko-create__cta">
            {step === 1 && (
              <>
                <Button
                  type="button"
                  size="lg"
                  onClick={() => {
                    if (validateName()) setStep(2);
                  }}
                >
                  Continue →
                </Button>
                <p className="eko-create__hint">Next: choose your state</p>
              </>
            )}
            {step === 2 && (
              <>
                <Button
                  type="button"
                  size="lg"
                  disabled={!cityId}
                  onClick={() => cityId && setStep(3)}
                >
                  {cityId ? `Continue → ${selectedCityName}` : "Continue →"}
                </Button>
                <p className="eko-create__hint">
                  {cityId ? "Next: choose your look" : "Pick a state to continue"}
                </p>
              </>
            )}
            {step === 3 && (
              <>
                <Button type="submit" size="lg" loading={busy}>
                  Start my story →
                </Button>
                <p className="eko-create__fineprint">
                  One character per account. Choose wisely — your city remembers.
                </p>
              </>
            )}
          </footer>
        </form>
      )}
    </div>
  );
}
