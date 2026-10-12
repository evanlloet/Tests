# Léa — pilotage commercial et tournées en pharmacie

Léa est une application web (mobile d'abord) destinée à une commerciale itinérante qui visite des pharmacies
(Calvados, Manche, Orne, Ille-et-Vilaine, Mayenne). Elle centralise le référentiel des pharmacies, reconstruit
l'historique des visites à partir de l'agenda Outlook, calcule les échéances de visite (A/B/C : 4 par an, D : 3 par an),
propose les prochains créneaux et compare l'ordre des tournées avec un ordre optimisé, sans jamais rien modifier
sans validation.

> Toutes les données sont persistées dans PostgreSQL. Aucune donnée métier n'est stockée uniquement dans le navigateur.

---

## Ce que fait la V1

| Brief (§ 20) | État | Où |
|---|---|---|
| 1. Accueil : rendez-vous du jour, prochaines actions, grand bouton « Rendez-vous terminé » | ✅ | `/` |
| 2. Calendrier jour / semaine / mois, création, modification, glisser-déposer | ✅ | `/planning` |
| 3. Référentiel : recherche, filtres (secteur, catégorie, échéance), fiches | ✅ | `/pharmacies` |
| 4. Import des pharmacies : fichier clients Excel ou CSV (rejouable, sans doublons) | ✅ | `/pharmacies/import` |
| 5. Import calendrier ICS / CSV Outlook : prévisualisation, normalisation, doublons | ✅ | `/imports` |
| 6. Rapprochement rendez-vous ↔ pharmacies, validation manuelle des cas incertains | ✅ | `/rapprochements` |
| 7. Fréquences ABCD modifiables (globalement et par pharmacie) | ✅ | `/profil`, fiche |
| 8. Secteurs par jour : modèle principal + variante Orne/Mayenne, activables par semaine | ✅ | `/profil`, `/planning` |
| 9. Carte interactive des pharmacies et des rendez-vous (liste synchronisée) | ✅ | `/carte` |
| 10. Simulation de tournée : ordre actuel vs ordre optimisé, avec explications | ✅ | `/tournees` |

Également livré :

- **Prochaine visite** : après « Rendez-vous terminé », Léa calcule l'échéance et classe les créneaux à partir du planning
  complet (secteur du jour, détour, rendez-vous voisins, préférences du pharmacien, charge, jours fériés, retour au
  domicile), avec avantages et inconvénients de chaque option (`/pharmacies/[id]/prochaine-visite`).
- **Pilotage** : visites par pharmacie et fréquence historique, répartition par jour, secteurs visités chaque jour, durées,
  journées lointaines et nuits probables, regroupements récurrents, kilométrage estimé, couverture des objectifs,
  qualité des données (`/pilotage`).
- **Pharmacies à visiter près d'une tournée** (en retard ou bientôt dues, avec le créneau compatible).
- **Lieux favoris** (hôtels, restaurants, piscines) utilisables comme départ / arrivée d'une tournée.
- **Journal des modifications** (`audit_logs`) pour tout changement de planning, rapprochement et référentiel.
- **Export JSON** de toutes ses données et **suppression du compte** (cascade).
- Mode clair / sombre, navigation inférieure sur mobile, barre latérale sur ordinateur.

### Interface ludique (V1.1)

- **Design coloré** : fond lilas, tuiles pastel, boutons « pilule » encre, polices auto-hébergées (Bricolage
  Grotesque pour les titres, Outfit pour le texte). Jetons CSS clairs / sombres ; sur une tuile pastel les jetons
  restent « clairs » (`.pastel-scope`) pour garder le contraste en mode sombre.
- **Bonshommes d'humeur** (SVG maison, 6 formes × 8 humeurs) : chaque journée a le sien selon sa **charge réelle**
  (visites + trajets estimés + pause comparés à l'amplitude, alertes), pas seulement le nombre de rendez-vous :
  « Tranquille », « Idéale », « Chargée », « Trop chargée », « Libre », week-end / férié
  (`src/domain/mood.ts`). Visibles sur l'accueil, la semaine, la vue jour et la nouvelle **vue mois** (calendrier
  d'humeur).
- **Fiches pharmacie ludiques** : avatar propre à chaque pharmacie dont l'humeur suit l'échéance (en avance,
  prévue, bientôt due, en retard, jamais vue), cœurs pour les visites de l'année, frise « Votre histoire ensemble »,
  comptes rendus en bulles, détails repliables.
- **Accueil pas à pas** (`/bienvenue`), enregistré en base étape par étape et reprenable : domicile (communes du
  secteur ou coordonnées), départements couverts, semaine type, rythme (horaires, pause, durée de visite), fréquences
  ABCD, choix du jeu, visite guidée des fonctionnalités, puis premiers imports. Rejouable depuis le profil ; les
  comptes créés avant cette version sont marqués comme accueillis par la migration `0001`.
- **Gamification facultative** (désactivable dans le profil ou `/recompenses`) : points, 8 niveaux (de Graine à
  Légende), 12 badges, 4 défis hebdomadaires, « série douce » (les jours sans visite ne la cassent pas), célébration
  après « Rendez-vous terminé ». Tout est **recalculé à partir des faits en base** (visites clôturées, comptes rendus,
  rapprochements vérifiés, km économisés par une tournée appliquée) : aucun compteur ne peut diverger. Valider ou
  ignorer un rapprochement rapporte autant, pour ne pas inciter à valider à tort.

### Critères d'acceptation du MVP (§ 19)

Tous les critères sont couverts et vérifiés par les tests automatisés (voir « Tests ») : import et consultation des
pharmacies, persistance, import Outlook sans doublons, vérification et correction des rapprochements, visites et
échéances sur les fiches, création / modification / déplacement des rendez-vous, préférences hebdomadaires, tournée
sur la carte, scénario respectant les contraintes, comparaison au planning initial, validation explicite des
changements importants, données intactes après déconnexion / reconnexion.

---

## Intégrations externes : état réel

| Service | État | Détail |
|---|---|---|
| PostgreSQL | ✅ vérifié | Testé sur PostgreSQL 16 (tests d'intégration et parcours complet). Compatible Supabase. |
| Calcul d'itinéraires (OSRM) | ⚠️ **codé, non vérifié** | Activé si `OSRM_URL` est renseigné. Sans moteur, Léa affiche une **estimation à vol d'oiseau clairement signalée** (jamais présentée comme un itinéraire). En cas d'échec d'OSRM, repli sur l'estimation avec un message. |
| Géocodage Géoplateforme IGN | ⚠️ **codé, non vérifié** | Utilisé à la demande (bouton « Géolocaliser »). Un résultat peu sûr est ignoré : la fiche reste sans coordonnées. |
| Fond de carte Plan IGN | ⚠️ **non vérifié** | MapLibre fonctionne (points, tournée, sélection) ; le fond de carte n'a pas pu être chargé dans l'environnement de développement (réseau restreint). Un message s'affiche si les tuiles sont injoignables. |
| Microsoft Graph (Outlook) | ❌ non disponible | Import de fichiers ICS / CSV uniquement. L'architecture d'import est prête à recevoir une synchronisation. |
| Assistant conversationnel (§ 11) | ❌ hors V1 | Non demandé dans la liste de la V1. Les calculs sont déjà des services déterministes réutilisables. |

L'environnement de développement de cette V1 bloquait l'accès à `data.geopf.fr`, aux serveurs OSRM, à Overpass et
à data.gouv.fr. Ces intégrations doivent donc être vérifiées lors du premier déploiement.

---

## Démarrage en local

Prérequis : Node.js ≥ 22.12 (version « LTS » sur nodejs.org) et PostgreSQL ≥ 15 (Mac : Postgres.app ; Windows :
installeur officiel de postgresql.org, qui demande un mot de passe pour l'utilisateur `postgres`).

```bash
npm install                      # copie aussi le worker MapLibre dans public/vendor
npm run setup                    # crée .env (demande l'utilisateur / mot de passe PostgreSQL), la base « lea » et les tables
npm run dev                      # puis ouvrir http://localhost:3000
```

`npm run setup` peut être relancé sans risque. Pour une base existante (Supabase, Neon…), copiez `.env.example`
en `.env`, renseignez `DATABASE_URL`, puis `npm run setup` (ou `npm run db:migrate`).

Créez ensuite le compte sur `/inscription` (avec `ALLOW_SIGNUP=true`), puis passez `ALLOW_SIGNUP=false`.
Sans inscription ouverte : `npm run user:create -- adresse@exemple.fr Prénom` (mot de passe demandé).

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL (**obligatoire**). Supabase : pooler de session (5432) ou de transaction (6543, requêtes préparées désactivées automatiquement). |
| `ALLOW_SIGNUP` | `true` pour autoriser l'inscription depuis l'écran ; `false` ensuite. |
| `OSRM_URL` | Serveur OSRM pour des temps de trajet routiers (facultatif). |
| `GEOCODER_URL` | Géocodeur (par défaut Géoplateforme IGN) ; vide pour désactiver. |
| `NEXT_PUBLIC_MAP_RASTER_TILES`, `NEXT_PUBLIC_MAP_ATTRIBUTION` | Tuiles du fond de carte (seules variables exposées au navigateur). |

Aucun secret n'est envoyé au navigateur. Les clés éventuelles (OSRM privé, etc.) restent côté serveur.

### Déploiement conseillé

- Base : Supabase (PostgreSQL). Lancer `npm run db:migrate` avec la chaîne de connexion de la base.
- Application : Vercel ou tout hébergeur Node (`npm run build && npm start`).
- Activer HTTPS (cookies de session `Secure` en production).
- Sauvegardes : sauvegardes quotidiennes / PITR de Supabase, ou `pg_dump` planifié
  (`pg_dump --format=custom "$DATABASE_URL" > lea-$(date +%F).dump`, restauration avec `pg_restore`).
  Chaque utilisatrice peut aussi exporter ses données (Profil › Exporter mes données).

---

## Premiers pas (avec les vraies données)

1. **Accueil pas à pas** (proposé à l'inscription) : domicile, secteurs, semaine type, rythme, fréquences ABCD. Tout
   reste modifiable ensuite dans le **Profil**.
2. **Pharmacies › Importer un fichier** : le fichier clients Excel du laboratoire (voir ci-dessous), un CSV ou une
   extraction FINESS retravaillée.
3. **Imports Outlook** : exporter ~2 ans de calendrier en `.ics` (recommandé) ou `.csv`, prévisualiser, confirmer.
4. **Rapprochements** : valider, corriger (« Choisir une autre pharmacie ») ou ignorer les cas incertains.
5. **Pilotage** : vérifier l'historique reconstruit (secteurs par jour, fréquences, journées lointaines).
6. Compléter les catégories ABCD manquantes : sans catégorie, aucune échéance n'est calculée (rien n'est deviné).

### Format du CSV des pharmacies

Séparateur `;` `,` ou tabulation, UTF-8 ou Windows-1252 (Excel). En-têtes reconnus sans tenir compte des accents
ni des majuscules (voir l'écran d'import pour la liste complète) :

```
Nom;Adresse;Code postal;Ville;FINESS;Latitude;Longitude;Catégorie;CA;Potentiel;Visites par an
Pharmacie Exemple;1 rue de la Gare;14000;Caen;140000000;49,18;-0,37;A;1250000;fort;
```

Seul le nom est obligatoire. Identification d'une pharmacie existante : identifiant externe (code client,
FINESS…), sinon nom + code postal + commune. Une valeur vide (ou « - ») n'efface jamais une valeur existante ; une
valeur illisible est ignorée et signalée.

### Fichier clients Excel (export « CLIENTS » du laboratoire)

Le classeur `.xlsx` s'importe tel quel (première feuille remplie, lecture maison du format Office Open XML avec
`fflate`, sans dépendance lourde). Correspondance des colonnes :

| Colonne du fichier | Dans Léa |
|---|---|
| Code | Code client (identifiant de réimport) |
| Lib Sous-Canal Client | Canal : « Pharmacie » ou « GMS » (pastille sur la fiche, filtre) |
| Nom Client | Nom affiché sous une forme lisible (« SELARL GDE PHIE DU MOULIN » → « Grande Pharmacie du Moulin ») ; la raison sociale d'origine est conservée |
| Code Postal, Ville | Code postal, commune, département |
| N° Tel, Adresse Mail | Téléphone (lien d'appel), e-mail (lien `mailto:`) |
| Code UGA 746 Tiers Cde | Zone commerciale (filtre) ; un code postal éloigné du département de la zone est signalé |
| Lib Groupement Client | Groupement (recherche) |
| Ciblage Client Oral Care | Catégorie A/B/C/D → fréquence de visite |
| Ciblage Premium / Perfect Store / TLV / GC | Ciblages (pastilles, filtre) ; une valeur qui n'est pas l'initiale est gardée telle quelle (« GC (R) ») |
| Date de dernière Commande | Dernière commande (jamais comptée comme une visite) |
| Date de prochaine visite | Visite prévue au fichier (affichée, comparée aux rendez-vous ; aucun rendez-vous créé automatiquement) |
| CAf CFaj A-1, CAf A | CA A-1 et CA A |
| Evol A/A-1 | Recalculée par Léa à partir des deux CA |
| Nom Agent Oral Care, KAM régional, autres | Conservées telles quelles dans « Autres informations » (fiche › Provenance) |

Le fichier ne contient pas d'adresse : chaque fiche est placée **au centre de sa commune** (position marquée
approximative, points atténués sur la carte), ce qui suffit pour estimer les trajets entre communes. La référence
des communes (`src/data/communes-ouest.json`, 12 départements : les 5 suivis et leurs voisins) est générée par
`scripts/build-communes.mjs` à partir de sources ouvertes (INSEE / Etalab pour noms et codes postaux, IGN Admin
Express 2018 pour les centres) ; elle reconnaît les communes déléguées (« Tourlaville ») et les anciens noms
(« Le Hom », « Saline »). Une commune introuvable (ex. code postal incohérent) est signalée, jamais devinée. Une
position précise (saisie, géocodage) n'est jamais remplacée par un centre de commune. Le géocodage à l'adresse
reste disponible sur chaque fiche.

Le fichier de test `tests/fixtures/clients-exemple.xlsx` reproduit ce format avec des **données fictives**
(généré par `tests/fixtures/make-clients-xlsx.py`) ; aucun fichier client réel n'est versionné.

---

## Règles métier implémentées

- **Ne rien inventer** : catégorie, chiffre d'affaires, coordonnées ou préférences inconnus restent vides.
- **Planifié ≠ réalisé** : un rendez-vous issu de l'agenda est « identifié » ; il devient « réalisé » via
  « Rendez-vous terminé » ou le marquage manuel. Une proposition passée jamais confirmée ne compte pas.
- **Provenance** : événement Outlook d'origine conservé tel quel (`calendar_events.raw`), import, score et raisons
  du rapprochement, source des coordonnées.
- **Rapprochement** : score 0–1 (mots distinctifs pondérés par leur rareté, commune / code postal, fautes de frappe,
  adresse) puis départage par le **contexte de la journée** (secteur et lieux des autres rendez-vous du même jour,
  ou, à défaut, consensus entre les rendez-vous ambigus du même jour). Validation automatique seulement si
  score ≥ seuil (0,9 par défaut, réglable) **et** écart net avec le 2ᵉ candidat ; la validation groupée exclut les
  cas ambigus. Sur des données de test fictives (1 841 événements, 58 pharmacies dont des homonymes) :
  1 645 rapprochements automatiques, **tous corrects** ; 61 soumis à validation, avec la bonne pharmacie proposée
  en tête dans 9 cas sur 10.
- **Imports idempotents** : clé stable par événement (UID + occurrence en ICS, empreinte en CSV), doublons
  inter-formats signalés, décisions de rapprochement conservées lors d'un réimport ; un événement déplacé dans
  Outlook met à jour son rendez-vous seulement s'il n'a pas été modifié dans Léa.
- **Rendez-vous confirmés** : jamais déplacés par le moteur. Un déplacement manuel (formulaire ou glisser-déposer)
  demande une confirmation explicite. Le mode « autoriser le déplacement des confirmés » d'une simulation liste les
  rendez-vous concernés et exige une seconde confirmation.
- **Tournées** : durées de visite, temps tampon, pause déjeuner protégée, fenêtres horaires du pharmacien,
  amplitude de la journée, conduite maximale ; recherche exhaustive jusqu'à 8 visites, recherche locale au-delà.
  Chaque contrainte non respectée est expliquée ; le planning actuel peut toujours être conservé.
- **Fuseaux** : instants stockés en UTC, règles appliquées en heure de Paris ; fuseaux Windows d'Outlook
  (« Romance Standard Time ») et définitions VTIMEZONE gérés ; récurrences, exceptions et annulations prises en compte.

---

## Architecture

```
src/
  domain/          Règles métier pures et testées (aucun accès base ni réseau)
    calendar/      Lecture ICS / CSV Outlook, décodage, classement des événements
    routing/       Simulation d'une journée, optimisation, estimation sans routage
    scheduling/    Propositions de créneaux
    analytics/     Analyse de l'historique
    matching.ts    Rapprochement agenda ↔ pharmacies
    frequency.ts   Fréquences ABCD et échéances
    mood.ts        Humeur des journées et des pharmacies (bonshommes)
    gamification.ts Points, niveaux, badges, défis, série douce (calcul pur)
  integrations/    Fournisseurs remplaçables : routage (OSRM / estimation), géocodage
  server/
    db/            Schéma Drizzle (PostgreSQL) et client
    auth/          Mots de passe (scrypt), sessions en base, limitation des tentatives
    repositories/  Accès aux données, toujours filtré par utilisateur
    services/      Orchestration (imports, rapprochement, planning, tournées, analyses)
    actions/       Server Actions validées avec zod
  app/             Pages Next.js (App Router)
  components/      Interface (React, Tailwind)
drizzle/           Migrations SQL
tests/             Tests d'intégration PostgreSQL, parcours e2e, données de test fictives
```

Stack : Next.js 16, React 19, TypeScript, Tailwind CSS 4, Drizzle ORM, PostgreSQL, MapLibre GL, ical.js, Vitest.
Le choix de PostgreSQL « standard » (plutôt que le SDK Supabase) garde l'application portable ; Supabase reste la
cible d'hébergement recommandée. Les coordonnées sont des colonnes `lat` / `lng` ; PostGIS pourra être ajouté
pour des requêtes spatiales à grande échelle.

### Modèle de données

Les 16 tables du brief (`users`, `pharmacies`, `pharmacy_metrics`, `pharmacy_preferences`, `appointments`,
`visit_reports`, `calendar_imports`, `appointment_matches`, `territories`, `weekly_preferences`, `route_plans`,
`route_stops`, `travel_preferences`, `favorite_places`, `notifications`, `audit_logs`) plus `sessions`,
`calendar_events` (événements bruts), `pharmacy_imports`, `weekly_preference_templates` et
`week_template_assignments`. Identifiants UUID, dates de création / modification, champs de provenance, contraintes
`CHECK` sur les statuts et horaires.

---

## Sécurité et confidentialité

- Authentification serveur : mots de passe hachés (scrypt), sessions stockées en base (jeton haché), cookie
  `httpOnly` / `SameSite=Lax` / `Secure` en production, limitation des tentatives de connexion.
- Contrôle d'accès sur chaque page, action et requête (`requireUser()` + filtre `user_id`) ; isolation testée.
- Server Actions protégées contre le CSRF par Next.js (vérification d'origine) ; en-têtes de sécurité HTTP.
- Journal des modifications ; export et suppression complète des données par l'utilisatrice.
- La description des rendez-vous Outlook n'est utilisée pour le rapprochement que si l'utilisatrice l'autorise.
- À faire avant un usage avec des données réelles : analyse RGPD (registre, durée de conservation, information des
  personnes), hébergement en UE, politique de confidentialité. Commencer par un environnement de test.

---

## Tests

```bash
npm run typecheck && npm run lint
npm test                 # 143 tests unitaires et d'intégration (PostgreSQL requis : base lea_test)
npm run test:e2e         # parcours complet dans Chromium (application démarrée ; CHROMIUM_PATH si besoin)
```

Les tests d'intégration utilisent `TEST_DATABASE_URL` (défaut `postgres://lea:lea@localhost:5432/lea_test`).
Le parcours e2e génère des **données de test fictives** (noms inventés, communes réelles) et vérifie notamment :
accueil pas à pas, réimports sans doublons, rapprochement, glisser-déposer, clôture d'une visite et points gagnés,
application d'un scénario de tournée, import d'un fichier clients Excel, export, données intactes après
reconnexion, absence d'erreur JavaScript et de débordement sur mobile.

---

## Limites connues et prochaines étapes

1. **Vérifier les intégrations** sur l'hébergement final : tuiles IGN, géocodage, OSRM (serveur à héberger ou
   service tiers). Valhalla / GraphHopper peuvent être ajoutés derrière la même interface (`src/integrations/routing`).
2. **Microsoft Graph** : application Azure, consentement, stockage chiffré des jetons, synchronisation incrémentale.
3. **Référentiel national** : import direct FINESS / OpenStreetMap (le CSV couvre déjà ces formats retravaillés).
4. **Assistant conversationnel** (§ 11) branché sur les services existants, avec simulation avant confirmation.
5. **Hébergement, restaurants, piscines** : suggestions selon l'heure d'arrivée et les horaires d'ouverture.
6. **Veille commerciale** (§ 12) et **notifications** (la table existe, pas encore alimentée).
7. Mesure des gains réels dans le temps (km évités, couverture) une fois des tournées appliquées.
8. Multi-utilisateurs / équipes : le modèle isole déjà les données par utilisateur ; ajouter une notion d'équipe.
9. Limitation des tentatives de connexion partagée (table ou Redis) en cas de déploiement multi-instances.
