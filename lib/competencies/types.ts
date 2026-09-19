export interface CompetencyDefinition {
  code: string; name: string; definition: string; category: "core" | "functional" | "leadership"; levels: string[];
}
export interface Framework {
  id: string; library_key: string; version: number; name: string; status: "draft" | "published" | "archived"; definitions: CompetencyDefinition[];
}
export interface LearningLink {
  id: string; framework_id: string; competency_code: string; content_kind: "course" | "learning_path" | "assessment";
  content_id: string; target_level: number; source: string; rationale: string; status: string;
}
export interface DevelopmentSignal {
  frameworkId: string; competencyCode: string; targetLevel: number; observedLevel: number; gap: number;
  sourceGroup: string; cycleId: string; cycleName: string; releasedAt: string; basis: string;
}
export interface LearningOption { id: string; kind: LearningLink["content_kind"]; title: string; description: string; href: string; completed: boolean }
export interface DevelopmentRecommendation {
  linkId: string; title: string; href: string; reason: string; gap: number; decision: string; competency: string;
}
export interface CompetencyPack {
  id: string; packKey: string; version: number; name: string; roleFamily: string; description: string; competencyCount: number;
  sourceName: string; sourceUrl: string; licenseName: string; licenseUrl: string; attribution: string; activated: boolean; frameworkId: string | null; definitions: CompetencyDefinition[];
}
export interface TeamSignal {
  frameworkId: string; competencyCode: string; memberCount: number; targetLevel: number; observedLevel: number; gap: number; basis: string;
}
export interface TeamLearningRecommendation {
  linkId: string; frameworkId: string; title: string; href: string; competency: string; gap: number; memberCount: number; reason: string;
}
export interface CompetencyWorkspace {
  organizationId: string; isAdmin: boolean; consented: boolean; noticeVersion: string;
  frameworks: Framework[]; links: LearningLink[]; signals: DevelopmentSignal[];
  choices: Array<{ link_id: string; decision: string }>;
  rights: Array<{ id: string; kind: string; detail: string; status: string; resolution: string | null }>;
  questions: Array<{ id: string; prompt: string; cycle: string; scale: { min: number; max: number } }>;
  questionMaps: Array<{ question_id: string; competency_code: string; target_level: number }>;
  catalog: LearningOption[]; recommendations: DevelopmentRecommendation[];
  packs: CompetencyPack[]; managerAccess: boolean; directReportCount: number; managerConsented: boolean;
  teams: Array<{ id: string; name: string }>;
  periodDays: number; teamSignals: TeamSignal[]; teamRecommendations: TeamLearningRecommendation[];
}

/** Escape CSV fields and neutralise spreadsheet formula prefixes in admin-authored text. */
export function teamSignalsCsv(frameworks: Framework[], signals: TeamSignal[], periodDays: number): string {
  const quote = (value: string | number) => {
    const text = String(value);
    const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows: Array<Array<string | number>> = [["Framework", "Competency", "Members", "Observed level", "Target level", "Gap", "Period days", "Basis"]];
  for (const signal of signals.filter(s => s.memberCount >= 3)) {
    const framework = frameworks.find(f => f.id === signal.frameworkId);
    const name = framework?.definitions.find(c => c.code === signal.competencyCode)?.name ?? signal.competencyCode;
    rows.push([framework?.name ?? signal.frameworkId, name, signal.memberCount, signal.observedLevel, signal.targetLevel, signal.gap, periodDays, signal.basis]);
  }
  return rows.map(row => row.map(quote).join(",")).join("\r\n");
}

/** Manager recommendations use only aggregate signals and human-approved mappings. */
export function recommendTeamLearning(data: Pick<CompetencyWorkspace,"teamSignals"|"links"|"frameworks">, catalog: LearningOption[]): TeamLearningRecommendation[] {
  const results = new Map<string,TeamLearningRecommendation>();
  for (const signal of data.teamSignals) {
    if (signal.gap <= 0 || signal.memberCount < 3) continue;
    const competency=data.frameworks.find(f=>f.id===signal.frameworkId && f.status==="published")?.definitions.find(c=>c.code===signal.competencyCode);
    if (!competency) continue;
    for (const link of data.links) {
      if (link.status!=="approved" || link.framework_id!==signal.frameworkId || link.competency_code!==signal.competencyCode || link.target_level<signal.targetLevel) continue;
      const item=catalog.find(c=>c.id===link.content_id && c.kind===link.content_kind);
      if (!item) continue;
      const candidate={linkId:link.id,frameworkId:signal.frameworkId,title:item.title,href:item.href,competency:competency.name,gap:signal.gap,memberCount:signal.memberCount,
        reason:`Aggregate gap ${signal.gap.toFixed(2)} across ${signal.memberCount} consenting direct reports. ${link.rationale}`};
      const previous=results.get(link.id);
      if (!previous || candidate.gap>previous.gap) results.set(link.id,candidate);
    }
  }
  return [...results.values()].sort((a,b)=>b.gap-a.gap||a.title.localeCompare(b.title));
}

const TIER_NAMES: Record<number, string[]> = {
  3: ["Foundation", "Working", "Advanced"],
  4: ["Foundation", "Working", "Advanced", "Expert"],
  5: ["Foundation", "Working", "Proficient", "Advanced", "Expert"],
};
/**
 * Maps a numeric level (1-based; 0 means "below the first threshold") to a named
 * proficiency tier, for a competency defining `totalLevels` levels (3-5, the range the
 * framework editor already enforces). Presentation only — the stored data stays numeric,
 * since a competency's own level count varies and thresholds are defined against the
 * question's numeric rating scale, not a tier name.
 */
export function tierLabel(level: number, totalLevels: number): string {
  return TIER_NAMES[totalLevels]?.[level - 1] ?? `Level ${level}`;
}

/** Latest released signal per framework/competency/group; never mix self with other raters. */
export function recommendLearning(data: Pick<CompetencyWorkspace,"signals"|"links"|"frameworks"|"choices">, catalog: LearningOption[]): DevelopmentRecommendation[] {
  const latest = new Map<string, DevelopmentSignal>();
  for (const signal of data.signals) {
    const key = `${signal.frameworkId}:${signal.competencyCode}:${signal.sourceGroup}`;
    const previous = latest.get(key);
    if (!previous || signal.releasedAt > previous.releasedAt) latest.set(key, signal);
  }
  // Ranked by gap first (the reason a recommendation exists at all), then by how closely
  // the mapped content's own target level fits the level actually needed — content aimed
  // exactly at the gap is more relevant than content aimed higher, even though both
  // qualify (target_level >= signal.targetLevel) — then by curation trust: every mapping
  // needs human approval to exist, but a manual/imported one is a stronger relevance
  // signal on its own than an AI draft a human merely accepted.
  const SOURCE_TRUST: Record<string, number> = { manual: 0, import: 0, ai: 1 };
  const results = new Map<string, DevelopmentRecommendation & { levelFit: number; trust: number }>();
  for (const signal of latest.values()) {
    if (signal.gap <= 0 || signal.sourceGroup === "self") continue;
    const framework = data.frameworks.find((f) => f.id === signal.frameworkId && f.status === "published");
    const competency = framework?.definitions.find((c) => c.code === signal.competencyCode);
    if (!competency) continue;
    for (const link of data.links) {
      if (link.status !== "approved" || link.framework_id !== signal.frameworkId || link.competency_code !== signal.competencyCode || link.target_level < signal.targetLevel) continue;
      const item = catalog.find((c) => c.id === link.content_id && c.kind === link.content_kind && !c.completed);
      if (!item) continue;
      const choice = data.choices.find((c) => c.link_id === link.id)?.decision ?? "recommended";
      const levelFit = link.target_level - signal.targetLevel;
      const trust = SOURCE_TRUST[link.source] ?? 1;
      const previous = results.get(link.id);
      if (previous && (previous.gap > signal.gap || (previous.gap === signal.gap && previous.levelFit <= levelFit))) continue;
      results.set(link.id, { linkId: link.id, title: item.title, href: item.href, competency: competency.name, gap: signal.gap, decision: choice, levelFit, trust,
        reason: `${signal.cycleName}: ${signal.sourceGroup.replaceAll("_", " ")} feedback indicates ${tierLabel(signal.observedLevel, competency.levels.length)} (level ${signal.observedLevel}), against a target of ${tierLabel(signal.targetLevel, competency.levels.length)} (level ${signal.targetLevel}). ${link.rationale}` });
    }
  }
  return [...results.values()]
    .sort((a, b) => b.gap - a.gap || a.levelFit - b.levelFit || a.trust - b.trust || a.title.localeCompare(b.title))
    .map((r): DevelopmentRecommendation => ({ linkId: r.linkId, title: r.title, href: r.href, reason: r.reason, gap: r.gap, decision: r.decision, competency: r.competency }));
}
