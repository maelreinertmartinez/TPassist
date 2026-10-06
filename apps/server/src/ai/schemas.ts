import { z } from 'zod';

// Schémas des sorties structurées demandées à l'IA (validés par Zod après coup).

export const PageKindEnum = z.enum(['cours', 'td', 'tp', 'ei', 'corrige', 'autre']);

export const SegmentationSchema = z.object({
  pages: z.array(
    z.object({
      page: z.number().int().describe('Numéro de page (1 = première page du PDF)'),
      kind: PageKindEnum.describe(
        "cours = contenu de cours ; td/tp = feuille d'exercices de TD/TP ; ei = évaluation / examen / partiel ; corrige = corrigé ou correction ; autre = page de garde, sommaire, page blanche",
      ),
      unitTitle: z.string().describe("Titre de la partie à laquelle appartient la page (ex. « Chapitre 2 – Matrices », « TD 3 – Espaces vectoriels », « Corrigé du TD 3 »)"),
      startsNewUnit: z.boolean().describe('true si une nouvelle partie (chapitre, TD, TP, EI, corrigé) commence sur cette page'),
      startsMidPage: z.boolean().describe('true si la nouvelle partie commence au milieu de la page, après la fin de la partie précédente'),
    }),
  ),
});
export type Segmentation = z.infer<typeof SegmentationSchema>;

export const CourseExtractionSchema = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      pageStart: z.number().int(),
      pageEnd: z.number().int(),
      summary: z.string().describe('Résumé de 2 à 4 phrases'),
      keyConcepts: z.array(z.string()).describe('Notions clés : définitions, théorèmes, méthodes'),
      contentMd: z.string().describe('Transcription fidèle et complète du contenu en Markdown + LaTeX'),
      continuesPrevious: z.boolean().describe('true si cette section est la suite de la dernière section du lot précédent'),
    }),
  ),
});
export type CourseExtraction = z.infer<typeof CourseExtractionSchema>;

export const ExerciseExtractionSchema = z.object({
  durationMinutes: z.number().nullable().describe("Durée de l'épreuve en minutes si indiquée (EI), sinon null"),
  exercises: z.array(
    z.object({
      title: z.string().describe('Ex. « Exercice 2 – Diagonalisation »'),
      continuesPrevious: z.boolean().describe('true si cet exercice est la suite du dernier exercice du lot précédent'),
      contextMd: z.string().describe("Énoncé commun de l'exercice (données, valeurs, matrices), transcrit fidèlement ; vide si aucun"),
      questions: z.array(
        z.object({
          label: z.string().describe('Numérotation telle que dans le sujet (ex. « 1 », « 2.a », « Q3 »)'),
          statementMd: z.string().describe('Énoncé de la question transcrit fidèlement en Markdown + LaTeX, sans rien ajouter'),
          figurePages: z.array(z.number().int()).describe("Pages contenant une figure / un schéma / un graphique nécessaire à la question (vide sinon)"),
          dependsOnPrevious: z.boolean().describe("true si la question utilise le résultat d'une question précédente"),
          points: z.number().nullable().describe('Points du barème si indiqués, sinon null'),
          inlineSolutionMd: z
            .string()
            .nullable()
            .describe('Si le document contient la correction de cette question juste après son énoncé, sa transcription ; sinon null'),
        }),
      ),
    }),
  ),
});
export type ExerciseExtraction = z.infer<typeof ExerciseExtractionSchema>;

export const CorrigeExtractionSchema = z.object({
  targetTitle: z.string().describe('Titre du sujet corrigé (ex. « TD 3 – Espaces vectoriels »)'),
  solutions: z.array(
    z.object({
      exerciseLabel: z.string().describe('Ex. « Exercice 2 »'),
      questionLabel: z.string().describe('Ex. « 1.a » ; vide si la correction porte sur tout l’exercice'),
      solutionMd: z.string().describe('Transcription fidèle de la correction en Markdown + LaTeX'),
      pageStart: z.number().int().nullable(),
      pageEnd: z.number().int().nullable(),
    }),
  ),
});
export type CorrigeExtraction = z.infer<typeof CorrigeExtractionSchema>;

export const LinkCorrectionsSchema = z.object({
  links: z.array(
    z.object({
      corrigeUnitId: z.string(),
      targetUnitId: z.string().nullable().describe("Id de l'unité (TD/TP/EI) corrigée, ou null si aucune ne correspond"),
      matches: z.array(
        z.object({
          solutionIndex: z.number().int().describe('Index (0-based) de la solution dans la liste du corrigé'),
          questionId: z.string(),
        }),
      ),
    }),
  ),
});
export type LinkCorrections = z.infer<typeof LinkCorrectionsSchema>;

export const VerifySchema = z.object({
  verdict: z.enum(['correct', 'incorrect', 'partiel']),
  errorLocation: z
    .string()
    .nullable()
    .describe("Passage fautif recopié MOT POUR MOT depuis la réponse de l'étudiant (pour une photo : description précise de l'endroit). null si correct."),
  errorExplanation: z.string().nullable().describe("Explication pédagogique de l'erreur, sans donner toute la solution. null si correct."),
});
export type VerifyResult = z.infer<typeof VerifySchema>;

export const CourseRefsSchema = z.object({
  refs: z.array(
    z.object({
      sectionId: z.string(),
      why: z.string().describe('Pourquoi cette partie aide (une phrase, sans résoudre la question)'),
      excerptMd: z.string().describe('Extrait pertinent du cours (définition, théorème, méthode) en Markdown + LaTeX'),
    }),
  ),
});
export type CourseRefsResult = z.infer<typeof CourseRefsSchema>;

export const ReportExerciseSchema = z.object({
  questions: z.array(
    z.object({
      questionId: z.string(),
      explanationMd: z.string().describe("Explication complète : ce qui est juste, chaque erreur commise et pourquoi, comment l'éviter"),
      solutionMd: z.string().describe('Solution complète et expliquée'),
      score: z.number().nullable().describe('Points obtenus (EI uniquement, sinon null)'),
      maxScore: z.number().nullable().describe('Points de la question dans le barème (EI uniquement, sinon null)'),
    }),
  ),
});
export type ReportExercise = z.infer<typeof ReportExerciseSchema>;

export const ReportSummarySchema = z.object({
  strengthsMd: z.string().describe('Points forts (liste Markdown)'),
  overallMd: z.string().describe('Bilan global et conseils de révision (Markdown)'),
  blockingPoints: z.array(
    z.object({
      existingWeakPointId: z.string().nullable().describe("Id d'un point bloquant existant s'il s'agit de la même difficulté, sinon null"),
      notion: z.string().describe('Notion ou savoir-faire en difficulté (court)'),
      descriptionMd: z.string().describe('Description précise de la difficulté observée'),
      sectionIds: z.array(z.string()).describe('Sections de cours liées'),
      questionIds: z.array(z.string()).describe('Questions où la difficulté est apparue'),
    }),
  ),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const QuizGenSchema = z.object({
  title: z.string(),
  items: z.array(
    z.object({
      type: z.enum(['mcq', 'open']),
      promptMd: z.string(),
      choices: z.array(z.string()).describe('4 propositions pour un QCM, vide pour une question ouverte'),
      correctIndex: z.number().int().nullable().describe('Index (0-based) de la bonne réponse pour un QCM, sinon null'),
      expectedAnswerMd: z.string().nullable().describe('Réponse attendue pour une question ouverte, sinon null'),
      explanationMd: z.string().describe('Explication de la bonne réponse'),
      sourceQuestionId: z.string().nullable(),
      weakPointId: z.string().nullable().describe("Id du point bloquant travaillé par l'item, sinon null"),
    }),
  ),
});
export type QuizGen = z.infer<typeof QuizGenSchema>;

export const OpenGradeSchema = z.object({
  correct: z.boolean(),
  feedbackMd: z.string(),
});
export type OpenGrade = z.infer<typeof OpenGradeSchema>;

export const EiGenSchema = z.object({
  title: z.string(),
  durationMinutes: z.number(),
  exercises: z.array(
    z.object({
      title: z.string(),
      contextMd: z.string(),
      questions: z.array(
        z.object({
          label: z.string(),
          statementMd: z.string(),
          points: z.number(),
          solutionMd: z.string().describe('Solution complète et expliquée'),
          weakPointId: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type EiGen = z.infer<typeof EiGenSchema>;
