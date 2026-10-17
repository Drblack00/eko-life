import { useState } from "react";
import { worldApi, type CourseDetail } from "../../lib/api";
import { Button } from "../../components/Button";
import { WorldHead, WorldNotice, WorldLoading, useWorldState, naira } from "./worldShared";

/**
 * Èkó Trade School — 13 vocational courses × 5 lessons.
 * ₦1,000–₦4,000 per lesson, max 2 lessons/day, quiz per course,
 * certificate + career boost on completion.
 */
export function CoursesView({ token }: { token: string }) {
  const { state, loading, error, busy, notice, noticeKind, run } = useWorldState(
    worldApi.courses,
    token
  );
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  if (loading) return <div className="world-app"><WorldLoading /></div>;
  if (error || !state) {
    return (
      <div className="world-app">
        <WorldHead title="🎓 Trade School" />
        <WorldNotice kind="error">{error ?? "Couldn't load courses."}</WorldNotice>
      </div>
    );
  }

  const open = (id: string) =>
    run(async () => {
      setDetail(await worldApi.courseDetail(token, id));
      setAnswers({});
    });

  const takeLesson = (id: string) =>
    run(async () => {
      const r = await worldApi.courseLesson(token, id);
      setDetail(await worldApi.courseDetail(token, id));
      if (r.quizUnlocked) throw new Error(`Lesson done: "${r.lesson.title}". Quiz unlocked! 🎉`);
    }, `Lesson complete.`);

  const submitQuiz = (id: string) =>
    run(async () => {
      const d = detail;
      if (!d) return;
      const arr = d.quiz.map((_, i) => answers[i]);
      if (arr.some((a) => a == null)) throw new Error("Answer every question first.");
      const r = await worldApi.courseQuiz(token, id, arr);
      setDetail(await worldApi.courseDetail(token, id));
      if (!r.passed) throw new Error(`You got ${r.correct}/${r.total}. Read the lessons and try again.`);
    }, "Quiz passed — certificate earned! 🎓");

  if (detail) {
    const d = detail;
    const donePct = Math.round((d.lessonsDone / d.lessonsTotal) * 100);
    return (
      <div className="world-app">
        <WorldHead title={`${d.icon} ${d.name}`} sub={d.tagline} />
        <WorldNotice kind={noticeKind}>{notice}</WorldNotice>
        <Button onClick={() => setDetail(null)}>← All courses</Button>
        <div className="world-card">
          <div className="world-row">
            <span className="grow">Progress</span>
            <strong>{d.lessonsDone}/{d.lessonsTotal}</strong>
          </div>
          <div className="world-progress"><i style={{ width: `${donePct}%` }} /></div>
          <p className="world-muted">
            {d.fee ? `${naira(d.fee)} per lesson · ` : ""}{d.boostLabel} ·{" "}
            {d.lessonsTodayLeft} lesson{d.lessonsTodayLeft === 1 ? "" : "s"} left today
          </p>
          {d.lessons.map((l) => (
            <div key={l.n} className="world-row">
              <span className="grow">{l.done ? "✅" : "⬜"} {l.n}. {l.title}</span>
            </div>
          ))}
          {!d.certAwarded && d.lessonsDone < d.lessonsTotal && (
            <div className="world-btnrow">
              <Button onClick={() => takeLesson(d.id)} disabled={busy || d.lessonsTodayLeft <= 0}>
                {busy ? "…" : d.lessonsTodayLeft <= 0 ? "Daily limit reached" : `Take lesson ${d.lessonsDone + 1} · ${naira(d.fee)}`}
              </Button>
            </div>
          )}
        </div>

        {d.certAwarded ? (
          <div className="world-cert">
            <div style={{ fontSize: 40 }}>{d.icon}</div>
            <h3 style={{ margin: "8px 0" }}>Certificate of Completion</h3>
            <p className="world-muted">{d.name} · Èkó Trade School</p>
            <span className="world-pill world-pill--live">{d.boostLabel}</span>
          </div>
        ) : d.quizUnlocked ? (
          <div className="world-card">
            <h3>📝 Final quiz</h3>
            <p className="sub">Get at least 2 of 3 right to earn your certificate.</p>
            {d.quiz.map((q, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <p><strong>{i + 1}.</strong> {q.q}</p>
                {q.options.map((opt, j) => (
                  <button
                    key={j}
                    type="button"
                    className={`world-quiz-opt${answers[i] === j ? " world-quiz-opt--sel" : ""}`}
                    onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ))}
            <Button onClick={() => submitQuiz(d.id)} disabled={busy}>
              {busy ? "Marking…" : "Submit quiz"}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="world-app">
      <WorldHead
        title="🎓 Èkó Trade School"
        sub={`${state.courses.length} trades · max ${state.lessonsPerDay} lessons/day · certificates boost your hustle.`}
      />
      <WorldNotice kind={noticeKind}>{notice}</WorldNotice>
      <div className="world-grid">
        {state.courses.map((c) => (
          <button key={c.id} type="button" className="world-card" onClick={() => open(c.id)}>
            <h3>{c.icon} {c.name}</h3>
            <p className="sub">{c.tagline}</p>
            <div className="world-progress">
              <i style={{ width: `${Math.round((c.lessonsDone / c.lessonsTotal) * 100)}%` }} />
            </div>
            <div className="world-muted">
              {c.certAwarded ? "🎓 Certified" : `${c.lessonsDone}/${c.lessonsTotal} lessons`} · {naira(c.fee)}/lesson
            </div>
            <div style={{ marginTop: 6 }}>
              <span className="world-pill">{c.boostLabel}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
