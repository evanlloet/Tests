/**
 * Schéma PostgreSQL de Léa.
 *
 * Règles communes :
 * - chaque table métier porte un `user_id` : toutes les requêtes sont filtrées
 *   par utilisateur dans la couche d'accès aux données (src/server/repositories) ;
 * - identifiants stables (UUID), dates de création / modification ;
 * - champs de provenance (`source`, `source_*`) pour savoir d'où vient chaque donnée ;
 * - les données inconnues restent NULL : on n'invente jamais de valeur.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const userRef = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/* -------------------------------------------------------------------------- */
/* Utilisateurs & sessions                                                     */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    // Paramètres de planning
    workDayStart: time("work_day_start").notNull().default("08:30"),
    workDayEnd: time("work_day_end").notNull().default("18:30"),
    defaultVisitMinutes: smallint("default_visit_minutes").notNull().default(45),
    bufferMinutes: smallint("buffer_minutes").notNull().default(10),
    lunchStart: time("lunch_start").notNull().default("12:30"),
    lunchMinutes: smallint("lunch_minutes").notNull().default(60),
    // Fréquences annuelles par catégorie (modifiables globalement)
    frequencyA: smallint("frequency_a").notNull().default(4),
    frequencyB: smallint("frequency_b").notNull().default(4),
    frequencyC: smallint("frequency_c").notNull().default(4),
    frequencyD: smallint("frequency_d").notNull().default(3),
    // Rapprochement automatique : score minimal pour valider sans revue manuelle
    autoMatchThreshold: real("auto_match_threshold").notNull().default(0.9),
    // Parcours d'accueil (reprise à l'étape enregistrée)
    onboardingStep: smallint("onboarding_step").notNull().default(0),
    onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
    // Récompenses symboliques (points, badges, défis) : facultatives, désactivables
    gamificationEnabled: boolean("gamification_enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 du jeton : le jeton brut n'est jamais stocké.
    id: text("id").primaryKey(),
    userId: userRef(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* -------------------------------------------------------------------------- */
/* Territoires & préférences géographiques                                     */
/* -------------------------------------------------------------------------- */

export const territories = pgTable(
  "territories",
  {
    id: id(),
    userId: userRef(),
    kind: text("kind", { enum: ["department", "city", "custom"] }).notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("territories_user_kind_code_key").on(t.userId, t.kind, t.code)],
);

export const weeklyPreferenceTemplates = pgTable(
  "weekly_preference_templates",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("weekly_templates_user_name_key").on(t.userId, t.name)],
);

export const weeklyPreferences = pgTable(
  "weekly_preferences",
  {
    id: id(),
    userId: userRef(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => weeklyPreferenceTemplates.id, { onDelete: "cascade" }),
    /** ISO : 1 = lundi … 7 = dimanche */
    weekday: smallint("weekday").notNull(),
    territoryId: uuid("territory_id")
      .notNull()
      .references(() => territories.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("weekly_prefs_template_day_territory_key").on(t.templateId, t.weekday, t.territoryId),
    check("weekly_prefs_weekday_check", sql`${t.weekday} between 1 and 7`),
  ],
);

/** Modèle de secteurs activé pour une semaine donnée (sinon : modèle par défaut). */
export const weekTemplateAssignments = pgTable(
  "week_template_assignments",
  {
    userId: userRef(),
    /** Lundi de la semaine ISO */
    weekStart: date("week_start").notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => weeklyPreferenceTemplates.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekStart] })],
);

export const travelPreferences = pgTable("travel_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  homeLabel: text("home_label").notNull().default("Domicile"),
  homeAddress: text("home_address"),
  homeLat: doublePrecision("home_lat"),
  homeLng: doublePrecision("home_lng"),
  /** Temps de conduite maximal souhaité par jour (minutes) */
  maxDailyDriveMinutes: smallint("max_daily_drive_minutes").notNull().default(300),
  /** Au-delà de cette distance du domicile, une nuit d'hôtel est envisagée */
  hotelThresholdKm: smallint("hotel_threshold_km").notNull().default(150),
  /** Jours où le retour au domicile est impératif (ISO 1–7) */
  mustReturnHomeWeekdays: smallint("must_return_home_weekdays").array().notNull().default(sql`'{5}'::smallint[]`),
  /** Paramètres de l'estimation sans moteur de routage */
  estimateSpeedKmh: smallint("estimate_speed_kmh").notNull().default(90),
  estimateRoadFactor: real("estimate_road_factor").notNull().default(1.25),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* -------------------------------------------------------------------------- */
/* Référentiel pharmacies                                                      */
/* -------------------------------------------------------------------------- */

export const pharmacies = pgTable(
  "pharmacies",
  {
    id: id(),
    userId: userRef(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    /** Identifiant officiel / externe (FINESS, OSM…) lorsqu'il existe */
    externalId: text("external_id"),
    externalSource: text("external_source"),
    addressLine: text("address_line"),
    postalCode: text("postal_code"),
    city: text("city"),
    departmentCode: text("department_code"),
    phone: text("phone"),
    email: text("email"),
    /** Canal du fichier clients : « Pharmacie », « GMS »… */
    channel: text("channel"),
    /** Zone commerciale du fichier clients (code UGA, ex. « 14HER ») */
    salesZone: text("sales_zone"),
    /** Groupement d'achat */
    buyingGroup: text("buying_group"),
    /** Ciblages du fichier clients (« Premium », « Perfect Store »…) */
    targeting: text("targeting").array(),
    /** Colonnes du fichier sans équivalent dans Léa, conservées telles quelles */
    extra: jsonb("extra").$type<Record<string, string>>(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    geoPrecision: text("geo_precision", { enum: ["exact", "street", "city", "unknown"] }),
    geoSource: text("geo_source"),
    status: text("status", { enum: ["active", "closed", "unknown"] }).notNull().default("active"),
    /** Clé de dédoublonnage : nom normalisé | code postal | commune normalisée */
    dedupeKey: text("dedupe_key").notNull(),
    normalizedName: text("normalized_name").notNull(),
    source: text("source").notNull(),
    sourceImportId: uuid("source_import_id"),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("pharmacies_user_dedupe_key").on(t.userId, t.dedupeKey),
    uniqueIndex("pharmacies_user_external_key")
      .on(t.userId, t.externalSource, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("pharmacies_user_department_idx").on(t.userId, t.departmentCode),
    index("pharmacies_user_sales_zone_idx").on(t.userId, t.salesZone),
  ],
);

export const pharmacyImports = pgTable("pharmacy_imports", {
  id: id(),
  userId: userRef(),
  filename: text("filename").notNull(),
  fileSha256: text("file_sha256").notNull(),
  source: text("source").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  unchangedCount: integer("unchanged_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  issues: jsonb("issues").$type<{ row: number; message: string }[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const pharmacyMetrics = pgTable("pharmacy_metrics", {
  pharmacyId: uuid("pharmacy_id")
    .primaryKey()
    .references(() => pharmacies.id, { onDelete: "cascade" }),
  userId: userRef(),
  category: text("category", { enum: ["A", "B", "C", "D"] }),
  /** Chiffre d'affaires annuel (€) — NULL si inconnu */
  annualRevenue: numeric("annual_revenue", { precision: 14, scale: 2 }),
  potential: text("potential", { enum: ["fort", "moyen", "faible"] }),
  size: text("size"),
  /** CA de l'année précédente et de l'année en cours tels que fournis par le fichier clients (peuvent être négatifs : avoirs) */
  revenuePreviousYear: numeric("revenue_previous_year", { precision: 14, scale: 2 }),
  revenueCurrentYear: numeric("revenue_current_year", { precision: 14, scale: 2 }),
  /** Dernière commande connue (fichier clients) — ce n'est pas une visite */
  lastOrderOn: date("last_order_on"),
  /** Prochaine visite indiquée par le fichier clients (aucun rendez-vous n'est créé automatiquement) */
  plannedVisitOn: date("planned_visit_on"),
  /** Fréquence individuelle — prioritaire sur la fréquence de la catégorie */
  targetVisitsPerYear: smallint("target_visits_per_year"),
  source: text("source").notNull().default("manual"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check("pharmacy_metrics_category_check", sql`${t.category} in ('A', 'B', 'C', 'D')`),
  check("pharmacy_metrics_target_check", sql`${t.targetVisitsPerYear} between 1 and 52`),
  check("pharmacy_metrics_revenue_check", sql`${t.annualRevenue} >= 0`),
]);

export const pharmacyPreferences = pgTable("pharmacy_preferences", {
  pharmacyId: uuid("pharmacy_id")
    .primaryKey()
    .references(() => pharmacies.id, { onDelete: "cascade" }),
  userId: userRef(),
  preferredWeekdays: smallint("preferred_weekdays").array().notNull().default(sql`'{}'::smallint[]`),
  excludedWeekdays: smallint("excluded_weekdays").array().notNull().default(sql`'{}'::smallint[]`),
  preferredStart: time("preferred_start"),
  preferredEnd: time("preferred_end"),
  visitMinutes: smallint("visit_minutes"),
  constraints: text("constraints"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* -------------------------------------------------------------------------- */
/* Import calendrier (Outlook)                                                 */
/* -------------------------------------------------------------------------- */

export const calendarImports = pgTable("calendar_imports", {
  id: id(),
  userId: userRef(),
  filename: text("filename").notNull(),
  format: text("format", { enum: ["ics", "outlook_csv"] }).notNull(),
  fileSha256: text("file_sha256").notNull(),
  status: text("status", { enum: ["completed", "failed"] }).notNull(),
  totalEvents: integer("total_events").notNull().default(0),
  newEvents: integer("new_events").notNull().default(0),
  updatedEvents: integer("updated_events").notNull().default(0),
  unchangedEvents: integer("unchanged_events").notNull().default(0),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  error: text("error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Événements importés, conservés tels que lus (champ `raw`) + version normalisée.
 * `source_key` rend l'import rejouable : un même événement n'est jamais créé deux fois.
 */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: id(),
    userId: userRef(),
    importId: uuid("import_id")
      .notNull()
      .references(() => calendarImports.id, { onDelete: "cascade" }),
    lastSeenImportId: uuid("last_seen_import_id").references(() => calendarImports.id, { onDelete: "set null" }),
    sourceKey: text("source_key").notNull(),
    contentHash: text("content_hash").notNull(),
    uid: text("uid"),
    recurrenceId: text("recurrence_id"),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    sourceTimezone: text("source_timezone"),
    isCancelled: boolean("is_cancelled").notNull().default(false),
    isRecurring: boolean("is_recurring").notNull().default(false),
    /** Doublon probable d'un autre événement (même titre, mêmes horaires, UID différent) */
    duplicateOfId: uuid("duplicate_of_id"),
    classification: text("classification", { enum: ["visit", "not_visit", "unknown"] }).notNull(),
    classificationReason: text("classification_reason").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("calendar_events_user_source_key").on(t.userId, t.sourceKey),
    index("calendar_events_user_start_idx").on(t.userId, t.startsAt),
  ],
);

export type MatchCandidate = {
  pharmacyId: string;
  score: number;
  reasons: string[];
};

export const appointmentMatches = pgTable(
  "appointment_matches",
  {
    id: id(),
    userId: userRef(),
    calendarEventId: uuid("calendar_event_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    pharmacyId: uuid("pharmacy_id").references(() => pharmacies.id, { onDelete: "set null" }),
    score: real("score").notNull().default(0),
    status: text("status", {
      enum: ["auto_validated", "pending", "validated", "ignored", "no_candidate"],
    }).notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    candidates: jsonb("candidates").$type<MatchCandidate[]>().notNull().default([]),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("appointment_matches_event_key").on(t.calendarEventId),
    index("appointment_matches_user_status_idx").on(t.userId, t.status),
    check(
      "appointment_matches_status_check",
      sql`${t.status} in ('auto_validated', 'pending', 'validated', 'ignored', 'no_candidate')`,
    ),
    check("appointment_matches_score_check", sql`${t.score} between 0 and 1`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Rendez-vous & visites                                                       */
/* -------------------------------------------------------------------------- */

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    userId: userRef(),
    pharmacyId: uuid("pharmacy_id").references(() => pharmacies.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["visit", "unavailable", "other"] }).notNull().default("visit"),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Statut de planification */
    status: text("status", { enum: ["proposed", "pending", "confirmed", "cancelled"] }).notNull(),
    /** Réalisation : un rendez-vous planifié n'est pas une visite réalisée */
    outcome: text("outcome", { enum: ["unknown", "done", "missed"] }).notNull().default("unknown"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    source: text("source", { enum: ["manual", "calendar_import", "suggestion", "route_plan"] }).notNull(),
    calendarEventId: uuid("calendar_event_id").references(() => calendarEvents.id, { onDelete: "set null" }),
    /** Sur place ou par téléphone : un rendez-vous téléphonique n'entre pas dans les trajets */
    mode: text("mode", { enum: ["onsite", "phone"] }).notNull().default("onsite"),
    /** none : rien à signaler ; pending : détecté comme téléphonique, à valider ; validated : choix confirmé */
    modeReview: text("mode_review", { enum: ["none", "pending", "validated"] }).notNull().default("none"),
    /** Raison de la détection (« 181 km de Liffré sans le temps de faire la route »…) */
    modeReason: text("mode_reason"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("appointments_user_start_idx").on(t.userId, t.startsAt),
    index("appointments_pharmacy_idx").on(t.pharmacyId),
    uniqueIndex("appointments_calendar_event_key")
      .on(t.calendarEventId)
      .where(sql`${t.calendarEventId} is not null`),
    check("appointments_time_check", sql`${t.endsAt} > ${t.startsAt}`),
    check("appointments_status_check", sql`${t.status} in ('proposed', 'pending', 'confirmed', 'cancelled')`),
    check("appointments_outcome_check", sql`${t.outcome} in ('unknown', 'done', 'missed')`),
    check("appointments_kind_check", sql`${t.kind} in ('visit', 'unavailable', 'other')`),
    check("appointments_mode_check", sql`${t.mode} in ('onsite', 'phone')`),
    check("appointments_mode_review_check", sql`${t.modeReview} in ('none', 'pending', 'validated')`),
  ],
);

export const visitReports = pgTable(
  "visit_reports",
  {
    id: id(),
    userId: userRef(),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    pharmacyId: uuid("pharmacy_id")
      .notNull()
      .references(() => pharmacies.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    nextActions: text("next_actions"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("visit_reports_pharmacy_idx").on(t.pharmacyId)],
);

/* -------------------------------------------------------------------------- */
/* Tournées                                                                    */
/* -------------------------------------------------------------------------- */

export const routePlans = pgTable(
  "route_plans",
  {
    id: id(),
    userId: userRef(),
    planDate: date("plan_date").notNull(),
    kind: text("kind", { enum: ["current", "optimized"] }).notNull(),
    status: text("status", { enum: ["draft", "applied", "discarded"] }).notNull().default("draft"),
    /** Fournisseur des distances : « osrm » (routage réel) ou « estimate » (vol d'oiseau) */
    provider: text("provider").notNull(),
    totalDistanceKm: real("total_distance_km").notNull(),
    totalDriveMinutes: real("total_drive_minutes").notNull(),
    visitCount: smallint("visit_count").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    explanation: jsonb("explanation").$type<string[]>().notNull().default([]),
    comparedToPlanId: uuid("compared_to_plan_id"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("route_plans_user_date_idx").on(t.userId, t.planDate)],
);

export const routeStops = pgTable(
  "route_stops",
  {
    id: id(),
    userId: userRef(),
    routePlanId: uuid("route_plan_id")
      .notNull()
      .references(() => routePlans.id, { onDelete: "cascade" }),
    seq: smallint("seq").notNull(),
    kind: text("kind", { enum: ["start", "visit", "end"] }).notNull(),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
    pharmacyId: uuid("pharmacy_id").references(() => pharmacies.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    arrivalAt: timestamp("arrival_at", { withTimezone: true }),
    /** Début et fin de visite prévus (peuvent suivre l'arrivée d'une attente ou d'une pause) */
    visitStartAt: timestamp("visit_start_at", { withTimezone: true }),
    visitEndAt: timestamp("visit_end_at", { withTimezone: true }),
    departureAt: timestamp("departure_at", { withTimezone: true }),
    legDistanceKm: real("leg_distance_km"),
    legDriveMinutes: real("leg_drive_minutes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("route_stops_plan_seq_key").on(t.routePlanId, t.seq)],
);

/* -------------------------------------------------------------------------- */
/* Lieux personnels, notifications, journal                                    */
/* -------------------------------------------------------------------------- */

export const favoritePlaces = pgTable("favorite_places", {
  id: id(),
  userId: userRef(),
  kind: text("kind", { enum: ["hotel", "restaurant", "pool", "other"] }).notNull(),
  name: text("name").notNull(),
  address: text("address"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  priceNote: text("price_note"),
  url: text("url"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Retours sur les propositions de l'assistant de planification : journées acceptées
 * ou refusées (et pourquoi), clientes retirées ou reportées. L'assistant en tient
 * compte pour ses propositions suivantes (voir domain/assistant/learning).
 */
export const assistantFeedback = pgTable(
  "assistant_feedback",
  {
    id: id(),
    userId: userRef(),
    kind: text("kind", { enum: ["day", "client_day", "client_snooze"] }).notNull(),
    action: text("action", { enum: ["accepted", "rejected"] }).notNull(),
    day: date("day"),
    weekday: smallint("weekday"),
    departmentCode: text("department_code"),
    pharmacyId: uuid("pharmacy_id").references(() => pharmacies.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    until: date("until"),
    createdAt: createdAt(),
  },
  (t) => [index("assistant_feedback_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Cache des trajets routiers calculés par le moteur d'itinéraires (IGN, OSRM) :
 * évite de redemander les mêmes trajets. Coordonnées arrondies à ~10 m.
 * Ce sont des données routières, pas des données personnelles.
 */
export const routeLegs = pgTable(
  "route_legs",
  {
    provider: text("provider").notNull(),
    fromKey: text("from_key").notNull(),
    toKey: text("to_key").notNull(),
    distanceKm: real("distance_km").notNull(),
    durationMin: real("duration_min").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.fromKey, t.toKey] })],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: userRef(),
    kind: text("kind").notNull(),
    severity: text("severity", { enum: ["info", "important"] }).notNull().default("info"),
    title: text("title").notNull(),
    body: text("body"),
    related: jsonb("related").$type<Record<string, string>>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userRef(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_user_entity_idx").on(t.userId, t.entity, t.entityId)],
);

export type User = typeof users.$inferSelect;
export type Pharmacy = typeof pharmacies.$inferSelect;
export type PharmacyMetrics = typeof pharmacyMetrics.$inferSelect;
export type PharmacyPreferences = typeof pharmacyPreferences.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type AppointmentMatch = typeof appointmentMatches.$inferSelect;
export type Territory = typeof territories.$inferSelect;
export type TravelPreferences = typeof travelPreferences.$inferSelect;
export type RoutePlan = typeof routePlans.$inferSelect;
export type RouteStop = typeof routeStops.$inferSelect;
