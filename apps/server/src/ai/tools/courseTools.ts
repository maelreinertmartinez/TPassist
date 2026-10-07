// Outils MCP en lecture seule donnés à l'IA pour explorer le cours (liste et recherche des sections, lecture d'une
// section) et, pendant une séance, la liste des questions du sujet ouvert (jamais leurs solutions).
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, ftsSearch } from '../../db/client';
import { exercisesWithQuestions } from '../../db/repo';
import { courseSections, units } from '../../db/schema';

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }],
});

interface CourseToolsOptions {
  courseId: string;
  /** Unité ouverte (TP/TD/EI) : expose get_unit_outline. */
  unitId?: string;
}

/** Serveur MCP local, en lecture seule, donnant accès au contenu du cours. */
export function courseToolsServer({ courseId, unitId }: CourseToolsOptions) {
  const tools = [
    tool(
      'list_sections',
      'Liste toutes les sections de cours importées (id, chapitre, titre, pages, résumé, notions clés).',
      {},
      async () => {
        const rows = db
          .select({
            id: courseSections.id,
            title: courseSections.title,
            unitTitle: units.title,
            pageStart: courseSections.pageStart,
            pageEnd: courseSections.pageEnd,
            summary: courseSections.summary,
            keyConcepts: courseSections.keyConcepts,
          })
          .from(courseSections)
          .innerJoin(units, eq(units.id, courseSections.unitId))
          .where(eq(courseSections.courseId, courseId))
          .orderBy(asc(units.order), asc(courseSections.order))
          .all();
        if (rows.length === 0) return text('Aucune section de cours importée pour ce cours.');
        return text(rows);
      },
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'search_course',
      'Recherche plein texte dans le contenu du cours. Renvoie les sections les plus pertinentes avec un extrait.',
      { query: z.string().describe('Mots-clés à rechercher (notions, théorèmes, méthodes)') },
      async ({ query }) => {
        const hits = ftsSearch(courseId, query);
        if (hits.length === 0) return text('Aucun résultat. Essaie d’autres mots-clés ou list_sections.');
        return text(hits);
      },
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'read_section',
      'Lit le contenu complet (Markdown + LaTeX) d’une section de cours à partir de son id.',
      { sectionId: z.string().describe('Identifiant de la section (champ id de list_sections ou sectionId de search_course)') },
      async ({ sectionId }) => {
        const s = db
          .select()
          .from(courseSections)
          .where(and(eq(courseSections.id, sectionId), eq(courseSections.courseId, courseId)))
          .get();
        if (!s) return { ...text('Section introuvable.'), isError: true };
        return text(`# ${s.title} (pages ${s.pageStart ?? '?'}-${s.pageEnd ?? '?'})\n\n${s.contentMd}`);
      },
      { annotations: { readOnlyHint: true } },
    ),
  ];

  if (unitId) {
    tools.push(
      tool(
        'get_unit_outline',
        'Donne la liste des exercices et questions (énoncés uniquement, sans solution) du TD/TP/EI ouvert.',
        {},
        async () => {
          return text(
            exercisesWithQuestions(unitId).map(({ ex, questions }) => ({
              exercise: ex.title,
              context: ex.contextMd,
              questions: questions.map((q) => ({ id: q.id, label: q.label, statement: q.statementMd })),
            })),
          );
        },
        { annotations: { readOnlyHint: true } },
      ),
    );
  }

  return createSdkMcpServer({ name: 'course', version: '1.0.0', alwaysLoad: true, tools });
}
