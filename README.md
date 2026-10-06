# TPassist

Assistant local pour faire ses **TD, TP et EI** avec l'aide de l'IA, construit sur le **Claude Agent SDK**.
Toute l'application tourne dans **un seul conteneur Docker** et n'est accessible que depuis ta machine.

## Fonctionnalités

- **Dashboard de cours** en tuiles.
- **Import de PDF** (cours, TD, TP, EI, corrigés) : l'IA classe chaque page, découpe le document en parties
  (un même PDF peut mélanger cours et TD/TP), transcrit les énoncés question par question (Markdown + LaTeX)
  et rattache automatiquement les **corrigés officiels** à leur sujet quand il y en a.
- **Lecteur de TP/TD** question par question :
  - à gauche, l'énoncé seul (données de l'exercice, figures du PDF si besoin) et les aides :
    1. Reformuler l'énoncé — 2. Partie de cours utile — 3. Une indication — 4. La solution — 5. Question suivante ;
  - **verrous temporels** (en temps actif sur la question) : indice 2 min après la partie de cours, solution 2 min après l'indice ;
  - à droite, ta réponse en **texte/LaTeX** (aperçu en direct), **code** ou **photo de copie** ;
  - si c'est faux, seul « Faux » s'affiche, puis « Montrer où est l'erreur » (2 min) → « Expliquer l'erreur » (2 min) → « Donner la solution » (2 min) ;
  - la **solution expliquée** est toujours montrée avant de passer à la suite ;
  - passer sans répondre → « As-tu galéré ? ».
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

La consommation estimée (en $) est affichée en bas du dashboard.

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
apps/server   Fastify + Claude Agent SDK + SQLite (Drizzle)
  src/ai/         runAgent() (seul point d'appel au SDK), prompts, schémas Zod des sorties, outils MCP du cours
  src/jobs/       file de tâches : analyse PDF, rattachement des corrigés, bilans, quiz, génération d'EI
  src/services/   sessions & verrous, aides, chat, quiz, points bloquants, éditeur
apps/web      React + Vite + Tailwind, rendu Markdown/KaTeX, CodeMirror
packages/shared  types partagés API ↔ front
```

Chaque appel IA passe par `query()` du Claude Agent SDK, isolé de toute configuration locale
(`settingSources: []`, aucun outil intégré, seuls les outils MCP de lecture du cours sont autorisés),
avec sortie structurée validée par Zod quand une réponse JSON est attendue.
