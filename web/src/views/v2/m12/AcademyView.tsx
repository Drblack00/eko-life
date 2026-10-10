import { useEffect, useMemo, useState } from "react";
import { Card } from "../../../components/Card";
import { Button } from "../../../components/Button";
import { Dialog } from "../../../components/Dialog";
import type { M12Props } from "./SkillsPanel";
import "./m12.css";

export interface QuizQ {
  q: string;
  options: string[];
}

export interface CourseRow {
  id: string;
  name: string;
  icon: string;
  desc: string;
  lessons: number;
  feePerLesson: number;
  skill: string;
  skillXp: number;
  relatedJobs: string[];
  lessonsDone: number;
  lessonsLeftToday: number;
  certified: boolean;
  quizUnlocked: boolean;
  quiz: QuizQ[] | null;
}

function latestOf(messages: any[] | undefined, t: string): any {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].t === t) return messages[i];
  }
  return null;
}

const naira = (n: number) => "₦" + Number(n).toLocaleString("en-NG");

export function AcademyView({ you, send, messages }: M12Props) {
  const [courses, setCourses] = useState<CourseRow[] | null>(null);
  const [quizCourse, setQuizCourse] = useState<CourseRow | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);

  useEffect(() => {
    send("academy_courses", {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const msg = latestOf(messages, "academy_courses");
  useEffect(() => {
    if (msg && Array.isArray(msg.courses)) setCourses(msg.courses);
  }, [msg]);

  const list: CourseRow[] = useMemo(() => {
    if (courses) return courses;
    if (you && Array.isArray(you.academy)) return you.academy;
    return [];
  }, [courses, you]);

  const atCampus = useMemo(() => {
    const loc = String(you?.locationId || "");
    return ["unilag", "laspotech_gate", "etiosa_poly"].includes(loc);
  }, [you]);

  const openQuiz = (c: CourseRow) => {
    if (!c.quiz || c.quiz.length === 0) return;
    setAnswers(new Array(c.quiz.length).fill(null));
    setQuizCourse(c);
  };

  const submitQuiz = () => {
    if (!quizCourse) return;
    if (answers.some((a) => a === null)) return;
    send("academy_quiz", { course: quizCourse.id, answers });
    setQuizCourse(null);
  };

  return (
    <div className="m12-wrap">
      <div className="m12-head">
        <h2 className="m12-title">🎓 Academy</h2>
        <p className="m12-sub">
          Short Lagos-flavored courses at a campus. 4 lessons each, max 2 per
          day — then a 3-question quiz for a certificate worth +1 effective
          skill level on career gates.
        </p>
        {!atCampus && (
          <p className="m12-warn">📍 Head to Unilag, Lagos Poly or Eti-Osa to take lessons &amp; quizzes.</p>
        )}
      </div>

      {list.length === 0 && (
        <Card className="m12-empty">Loading courses…</Card>
      )}

      <div className="m12-course-grid">
        {list.map((c) => (
          <Card key={c.id} className="m12-course-card">
            <div className="m12-course-head">
              <span className="m12-course-icon" aria-hidden="true">{c.icon}</span>
              <div>
                <strong>{c.name}</strong>
                <div className="m12-course-skill">
                  +{c.skillXp} {c.skill} XP per lesson
                </div>
              </div>
              {c.certified && <span className="m12-cert-badge">🎓 Certified</span>}
            </div>
            <p className="m12-course-desc">{c.desc}</p>
            <div className="m12-course-meta">
              <span>📚 {c.lessonsDone}/{c.lessons} lessons</span>
              <span>{naira(c.feePerLesson)}/lesson</span>
              <span>⏳ {c.lessonsLeftToday} lesson{c.lessonsLeftToday === 1 ? "" : "s"} left today</span>
            </div>
            <div className="m12-course-actions">
              {!c.certified && c.lessonsDone < c.lessons && (
                <Button
                  disabled={!atCampus || c.lessonsLeftToday <= 0}
                  onClick={() => send("academy_lesson", { course: c.id })}
                >
                  Take lesson ({naira(c.feePerLesson)})
                </Button>
              )}
              {!c.certified && c.quizUnlocked && (
                <Button variant="accent" disabled={!atCampus} onClick={() => openQuiz(c)}>
                  Start quiz
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!quizCourse} onClose={() => setQuizCourse(null)} title={quizCourse ? `${quizCourse.icon} ${quizCourse.name} — Quiz` : ""}>
        {quizCourse && quizCourse.quiz && (
          <div className="m12-quiz">
            <p className="m12-quiz-rule">Answer all {quizCourse.quiz.length} — you need at least 2 right. The server marks it, so no peeking 😉</p>
            {quizCourse.quiz.map((qq, qi) => (
              <div key={qi} className="m12-quiz-q">
                <p className="m12-quiz-text"><strong>Q{qi + 1}.</strong> {qq.q}</p>
                <div className="m12-quiz-opts">
                  {qq.options.map((opt, oi) => (
                    <button
                      key={oi}
                      type="button"
                      className={`m12-quiz-opt${answers[qi] === oi ? " m12-quiz-opt--sel" : ""}`}
                      onClick={() => setAnswers((prev) => prev.map((a, i) => (i === qi ? oi : a)))}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <Button
              variant="accent"
              className="m12-quiz-submit"
              disabled={answers.some((a) => a === null)}
              onClick={submitQuiz}
            >
              Submit answers
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
