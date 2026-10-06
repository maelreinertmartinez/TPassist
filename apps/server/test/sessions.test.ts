import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, newId, openDb } from '../src/db/client';
import { insertExercises } from '../src/db/repo';
import { attempts, courses, sessionQuestions, units } from '../src/db/schema';
import { closeQuestion, createSession, getSessionState } from '../src/services/sessions';

let sessionId: string;
let q1: string;
let q2: string;

function sq(questionId: string) {
  return db.select().from(sessionQuestions).where(eq(sessionQuestions.questionId, questionId)).get()!;
}

beforeEach(() => {
  openDb(':memory:');
  const courseId = newId();
  const unitId = newId();
  db.insert(courses).values({ id: courseId, name: 'Test' }).run();
  db.insert(units).values({ id: unitId, courseId, kind: 'td', title: 'TD 1' }).run();
  const [ex] = insertExercises(unitId, null, [
    {
      title: 'Exercice 1',
      contextMd: '',
      questions: [
        { label: '1', statementMd: 'Q1', figurePages: [], dependsOnPrevious: false, points: null },
        { label: '2', statementMd: 'Q2', figurePages: [], dependsOnPrevious: false, points: null },
      ],
    },
  ]);
  [q1, q2] = ex.questionIds;
  sessionId = createSession(unitId, 'tp').id;
});

describe('passage à la question suivante', () => {
  it('« Passer la question » sans réponse : demande d’abord si on a galéré', () => {
    expect(() => closeQuestion(sessionId, q1, undefined, { skip: true })).toThrow(/du mal/);
  });

  it('« Passer la question » enchaîne directement sur la suivante, sans transition', () => {
    const st = closeQuestion(sessionId, q1, true, { skip: true });
    expect(st.currentQuestionId).toBe(q2);
    expect(st.current?.closed).toBe(false);
    expect(sq(q1)).toMatchObject({ closed: true, status: 'skipped' });
    expect(sq(q1).flags.selfStruggle).toBe(true);
  });

  it('après une bonne réponse, la question reste affichée pour la solution en transition', () => {
    db.insert(attempts)
      .values({ id: newId(), sessionId, questionId: q1, type: 'text', answerText: 'ok', verdict: 'correct', submittedAtMs: 0 })
      .run();
    const st = closeQuestion(sessionId, q1);
    expect(st.currentQuestionId).toBe(q1);
    expect(st.current?.closed).toBe(true);
  });

  it('passer la dernière question termine la séance', () => {
    closeQuestion(sessionId, q1, false, { skip: true });
    closeQuestion(sessionId, q2, false, { skip: true });
    expect(getSessionState(sessionId).session.status).toBe('reporting');
  });
});
