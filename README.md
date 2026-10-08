# TPassist

Assistant local pour faire ses **TD, TP et EI** avec l'aide de l'IA, construit sur le **Claude Agent SDK**.
Toute l'application tourne dans **un seul conteneur Docker** et n'est accessible que depuis ta machine.

## Fonctionnalités

- **Dashboard de cours** en tuiles ; chaque cours a ses onglets dans l'ordre du parcours :
  Cours · Notions · TD & TP · EI · Points bloquants · Historique · Documents.
  Un TD/TP/EI déjà fait affiche **Bilan** (dernière séance) et **Recommencer**.
- **Carte des notions** (onglet Notions), générée sur demande : carte mentale zoomable chapitres → notions → sous-notions
  (définitions, théorèmes, méthodes, formules), avec recherche, vue liste et mode plein écran. Un clic sur une notion ouvre sa **fiche complète**
  rédigée par l'IA au premier clic puis gardée (définition, formules, intuition, méthode, exemple, pièges), ses prérequis
  (tracés sur la carte), les notions qui l'utilisent et les extraits du cours d'origine. Un bandeau propose de régénérer
  la carte quand les chapitres ont changé.
- **Import de PDF** (cours, TD, TP, EI, corrigés) : l'IA classe chaque page, découpe le document en parties
  (un même PDF peut mélanger cours et TD/TP), transcrit les énoncés question par question (Markdown + LaTeX)
  et rattache automatiquement les **corrigés officiels** à leur sujet quand il y en a.
- **Ajout manuel d’une partie** : dans l’onglet Documents, un PDF analysé s’ouvre sur ses pages en miniatures, chacune marquée
  des parties déjà détectées. Choisis une plage de pages et un type (cours, TD, TP, EI ou corrigé) : l’IA transcrit la partie
  comme lors de l’analyse. Ces parties sont conservées si tu réanalyses le document.
- **Lecteur de TP/TD** question par question :
  - à gauche, l'énoncé seul (données de l'exercice, figures du PDF si besoin) et les aides :
    1. Reformuler l'énoncé — 2. Partie de cours utile — 3. Une indication — 4. La solution — 5. Question suivante ;
  - **verrous temporels** (en temps actif sur la question) : indice 2 min après la partie de cours, solution 2 min après l'indice ;
  - à droite, ta réponse en **texte/LaTeX** (aperçu en direct), **code** ou **photo de copie** ;
  - si c'est faux, seul « Faux » s'affiche, puis « Montrer où est l'erreur » (2 min) → « Expliquer l'erreur » (2 min) → « Donner la solution » (2 min) ;
  - après une bonne réponse, la **solution expliquée** est montrée avant de continuer ;
  - « Passer la question » enchaîne directement sur la suivante (sans réponse : « As-tu galéré ? » d’abord) ; la solution reste dans le bilan.
- **Chat « Poser une question »** à tout moment (cours ou sujet ouvert) ; il respecte les verrous.
- **Bilan de fin** (exportable en PDF) : chaque question, toutes tes réponses, les erreurs expliquées, la solution, tes points forts et tes **points bloquants**.
- **Quiz de révision facultatif** proposé en fin de séance, ciblé sur ce qui t'a posé problème.
- **Points bloquants** suivis par cours : prioritaires (~60 %) dans tous les quiz et EI générées, ils baissent quand tu réussis
  (« maîtrisé » après 2 réussites d'affilée) et se gèrent à la main.
- **Quiz complet** sur le cours (QCM + questions ouvertes).
- **EI blanches** : chronométrées, en mode « avec aides » ou « sans aide (examen) », notées sur 20 avec un barème extrait ou estimé ;
  l'IA peut **générer de nouvelles EI** dans le style des tiennes.
- **Sauvegarde automatique** : chaque session reprend exactement où tu t'étais arrêté.

## Démarrage

Prérequis : [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
cp .env.example .env
```

Renseigne **un** des deux identifiants dans `.env` :

- `ANTHROPIC_API_KEY` : clé API Anthropic (facturation à l'usage) ;
- `CLAUDE_CODE_OAUTH_TOKEN` : token d'abonnement Claude Pro/Max généré avec `claude setup-token`
  (usage personnel ; Anthropic recommande une clé API pour les applications).

Puis :

```bash
docker compose up -d --build
```

Ouvre <http://localhost:3000>. La pastille en haut à droite indique si l'IA est connectée.

Pour essayer l'interface sans consommer d'IA : `TPASSIST_AI_MOCK=1` dans `.env` (réponses simulées).

## Configuration (`.env`)

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` | — | Identifiant Claude (un des deux) |
| `TPASSIST_MODEL` | `claude-opus-5-5` | Modèle utilisé |
| `TPASSIST_MODEL_INGEST`, `TPASSIST_MODEL_TUTOR` | — | Modèle spécifique pour l'analyse des PDF / pour les aides et le chat |
| `TPASSIST_UNLOCK_DELAY_SEC` | `120` | Délai des verrous (temps actif) |
| `TPASSIST_AI_CONCURRENCY` | `3` | Appels IA simultanés |
| `TPASSIST_AI_MOCK` | `0` | `1` = mode simulation |
| `TPASSIST_PORT` | `3000` | Port local |

Un clic sur l’état de l’IA (en haut à droite) ouvre la page **Statistiques**, qui permet aussi de revérifier la connexion et détaille la consommation : coût estimé, appels, jetons, durée, répartition par jour, par usage, par tâche et par modèle, et les dernières erreurs.

## Données et sauvegarde

Toutes les données sont dans le volume Docker `tpassist-data` (base SQLite, PDF, pages rendues, photos, conversations).
Elles survivent à `docker compose down` / `up` (mais pas à `docker compose down -v`).

```bash
npm run backup
```

copie le volume dans `./backups/tpassist-AAAAMMJJ-HHMM/` (l'application est arrêtée quelques secondes pendant la copie).

## Développement

```bash
npm install
npm run dev        # API sur :3000 (tsx watch) + front Vite sur :5173
npm test           # tests unitaires (Vitest)
npm run typecheck
npm run sample-pdf # génère samples/exemple-algebre.pdf (cours + TD + corrigé + EI)
```

L'analyse des PDF nécessite `poppler-utils` (`pdfinfo`, `pdftoppm`, `pdftotext`), fourni dans l'image Docker.

### Système de design

L'interface s'inspire de Notion et suit les règles de *Refactoring UI* : tous les choix visuels sont définis d'avance
dans `apps/web/src/index.css` (couleurs HSL en nuances, 3 niveaux de texte, échelle de tailles 12→30 px, 2 graisses,
espacements 4/8/12/16/24/32/48/64/96 px, 2 rayons, 5 ombres d'élévation, mode sombre).

```bash
npm run lint:design   # refuse les valeurs hors système (tailles arbitraires, graisses, couleurs hexadécimales…)
```

### Architecture

```
packages/shared     types des échanges API ↔ front, un fichier par domaine (cours, séances, bilans, quiz, notions…),
                    constantes et fonctions pures communes (étapes des boutons d'aide, libellés, stripAccents)
apps/server         Fastify + Claude Agent SDK + SQLite (Drizzle)
  src/errors.ts       erreurs métier portant un statut HTTP (HttpError, notFound)
  src/utils.ts        petits utilitaires génériques (chunk, range, groupBy, dedupe…)
  src/db/             connexion et migrations, schéma, requêtes réutilisées (findById, nextOrder, courseUnits…)
  src/ai/             runAgent() (seul point d'appel au SDK), prompts, schémas Zod des sorties, outils MCP du cours
  src/ingest/         assemblage des résultats d'analyse des PDF (fonctions pures) et heuristiques de simulation
  src/pdf/            lecture et rendu des PDF (poppler)
  src/jobs/           file de tâches de fond et ses gestionnaires : analyse PDF, transcription d'une partie (aussi pour
                      l'ajout manuel à partir de pages choisies), corrigés, bilans, quiz, EI, notions
  src/services/       logique métier par domaine : cours, documents, séances (+ verrous), aides du tuteur, chat,
                      bilans, quiz, points bloquants, notions, éditeur, images, statistiques
  src/http/           routes (lecture de la requête puis délégation aux services) et diffusion SSE
  test/               tests Vitest (base SQLite en mémoire, IA simulée)
apps/web            React + Vite + Tailwind, rendu Markdown/KaTeX, CodeMirror, React Flow
  src/components/ui/  système de design : boutons, retours, formulaires, mise en page, fenêtres et tiroirs
  src/components/     composants partagés (chat, zone de réponse, aides, réponses, apparence d'un cours…)
  src/lib/            client API et SSE, mise en forme, images, fil d'Ariane, icônes des cours, plein écran
  src/pages/          une page par route ; les grandes pages ont leur dossier (course/, session/, quiz/, editor/, stats/),
                      avec la logique dans un hook (ex. useSession) et l'affichage découpé en composants
```

Règles suivies dans le code :
- **Une responsabilité par module** : les routes ne contiennent aucune règle métier, les services ne dépendent pas de Fastify.
- **Pas de duplication** : les requêtes, composants et utilitaires répétés vivent à un seul endroit (`db/repo.ts`,
  `components/ui/`, `lib/`, `packages/shared`).
- **Ouvert à l'extension** : ajouter un type de tâche, une aide ou une catégorie revient à ajouter une entrée dans une table
  (`registerJobHandler`, `HELP_ACTIONS`, `TASK_LABELS`), sans toucher à la logique.
- **Documentation** : chaque fichier commence par un commentaire qui décrit son rôle, chaque export a sa JSDoc.
- **Code mort** : `noUnusedLocals` et `noUnusedParameters` sont activés ; le compilateur refuse les imports et variables inutilisés.

Chaque appel IA passe par `query()` du Claude Agent SDK, isolé de toute configuration locale
(`settingSources: []`, aucun outil intégré, seuls les outils MCP de lecture du cours sont autorisés),
avec sortie structurée validée par Zod quand une réponse JSON est attendue.
