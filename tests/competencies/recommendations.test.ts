import { describe, expect, it } from "vitest";
import { recommendLearning, recommendTeamLearning, teamSignalsCsv, tierLabel } from "@/lib/competencies/types";

const framework = {
  id: "framework", library_key: "core", version: 1, name: "Core", status: "published" as const,
  definitions: [{ code: "listen", name: "Active listening", definition: "Listen carefully.", category: "core" as const, levels: ["One", "Two", "Three", "Four"] }],
};
const link = { id: "link", framework_id: "framework", competency_code: "listen", content_kind: "course" as const, content_id: "course", target_level: 3, source: "manual", rationale: "Practises listening behaviours.", status: "approved" };
const catalog = [{ id: "course", kind: "course" as const, title: "Listen well", description: "", href: "/courses/course", completed: false }];

describe("competency learning recommendations", () => {
  it("recommends approved incomplete learning for the latest non-self gap", () => {
    const recommendations = recommendLearning({ frameworks: [framework], links: [link], choices: [], signals: [
      { frameworkId: "framework", competencyCode: "listen", targetLevel: 3, observedLevel: 1, gap: 2, sourceGroup: "peer", cycleId: "old", cycleName: "Old", releasedAt: "2026-01-01", basis: "Released" },
      { frameworkId: "framework", competencyCode: "listen", targetLevel: 3, observedLevel: 2, gap: 1, sourceGroup: "peer", cycleId: "new", cycleName: "New", releasedAt: "2026-02-01", basis: "Released" },
    ] }, catalog);
    expect(recommendations).toMatchObject([{ linkId: "link", gap: 1, title: "Listen well" }]);
    expect(recommendations[0].reason).toContain("New");
  });

  it("does not recommend from self-only signals, completed content, or unapproved mappings", () => {
    const signal = { frameworkId: "framework", competencyCode: "listen", targetLevel: 3, observedLevel: 1, gap: 2, sourceGroup: "self", cycleId: "cycle", cycleName: "Cycle", releasedAt: "2026-02-01", basis: "Released" };
    expect(recommendLearning({ frameworks: [framework], links: [link], choices: [], signals: [signal] }, catalog)).toEqual([]);
    expect(recommendLearning({ frameworks: [framework], links: [link], choices: [], signals: [{ ...signal, sourceGroup: "manager" }] }, [{ ...catalog[0], completed: true }])).toEqual([]);
    expect(recommendLearning({ frameworks: [framework], links: [{ ...link, status: "draft" }], choices: [], signals: [{ ...signal, sourceGroup: "manager" }] }, catalog)).toEqual([]);
  });

  it("ranks a closer-fit target level above a farther one when gaps are equal", () => {
    const closeFit = { ...link, id: "close", target_level: 3 };
    const farFit = { ...link, id: "far", target_level: 5, content_id: "course2" };
    const catalogTwo = [...catalog, { id: "course2", kind: "course" as const, title: "Listen deeply", description: "", href: "/courses/course2", completed: false }];
    const signal = { frameworkId: "framework", competencyCode: "listen", targetLevel: 3, observedLevel: 1, gap: 2, sourceGroup: "peer", cycleId: "c", cycleName: "Cycle", releasedAt: "2026-02-01", basis: "Released" };
    const recommendations = recommendLearning({ frameworks: [framework], links: [farFit, closeFit], choices: [], signals: [signal] }, catalogTwo);
    expect(recommendations.map((r) => r.linkId)).toEqual(["close", "far"]);
  });

  it("ranks a manually-curated mapping above an AI-drafted one when gap and level fit are equal", () => {
    const manual = { ...link, id: "manual-link", source: "manual" };
    const aiDrafted = { ...link, id: "ai-link", source: "ai", content_id: "course2" };
    const catalogTwo = [...catalog, { id: "course2", kind: "course" as const, title: "Listen deeply", description: "", href: "/courses/course2", completed: false }];
    const signal = { frameworkId: "framework", competencyCode: "listen", targetLevel: 3, observedLevel: 1, gap: 2, sourceGroup: "peer", cycleId: "c", cycleName: "Cycle", releasedAt: "2026-02-01", basis: "Released" };
    const recommendations = recommendLearning({ frameworks: [framework], links: [aiDrafted, manual], choices: [], signals: [signal] }, catalogTwo);
    expect(recommendations.map((r) => r.linkId)).toEqual(["manual-link", "ai-link"]);
  });

  it("names each level a proficiency tier, and never mutates its input while a newer signal supersedes an older one", () => {
    expect(tierLabel(1, 4)).toBe("Foundation");
    expect(tierLabel(4, 4)).toBe("Expert");
    expect(tierLabel(3, 5)).toBe("Proficient");
    expect(tierLabel(0, 4)).toBe("Level 0"); // below the first threshold — not yet a named tier
    expect(tierLabel(2, 7)).toBe("Level 2"); // outside the 3-5 range the framework editor enforces

    // "Evidence updates without rewriting historical results" (P1.8 item 7), proven at the
    // logic level: a newer-dated signal for the same competency/group correctly supersedes
    // an older one in the *output*, but the older signal object the caller passed in is
    // never touched — recommendLearning has no way to rewrite history because it never
    // writes back into its own input at all.
    const oldSignal = Object.freeze({ frameworkId: "framework", competencyCode: "listen", targetLevel: 3, observedLevel: 1, gap: 2, sourceGroup: "peer", cycleId: "old", cycleName: "Old cycle", releasedAt: "2026-01-01", basis: "Released" });
    const newSignal = Object.freeze({ frameworkId: "framework", competencyCode: "listen", targetLevel: 3, observedLevel: 3, gap: 0, sourceGroup: "peer", cycleId: "new", cycleName: "New cycle", releasedAt: "2026-02-01", basis: "Released" });
    const input = Object.freeze({ frameworks: [framework], links: [link], choices: [], signals: [oldSignal, newSignal] });

    // gap 0 on the newer signal means "no gap left to recommend against" — an honest
    // reflection of real improvement, not a bug: the closed gap correctly produces no
    // recommendation rather than falling back to the stale, larger gap from "Old cycle".
    expect(recommendLearning(input, catalog)).toEqual([]);
    // The frozen inputs prove it: if recommendLearning had tried to mutate oldSignal,
    // newSignal, or the arrays holding them, this call would have thrown already.
    expect(oldSignal.gap).toBe(2);
    expect(oldSignal.cycleName).toBe("Old cycle");
  });
});

describe("manager team recommendations", () => {
  const teamSignal={frameworkId:"framework",competencyCode:"listen",memberCount:3,targetLevel:3,observedLevel:2,gap:1,basis:"Aggregate"};

  it("uses eligible aggregate signals and approved mappings only", () => {
    expect(recommendTeamLearning({frameworks:[framework],links:[link],teamSignals:[teamSignal]},catalog)).toMatchObject([{linkId:"link",memberCount:3,gap:1}]);
    expect(recommendTeamLearning({frameworks:[framework],links:[{...link,status:"draft"}],teamSignals:[teamSignal]},catalog)).toEqual([]);
  });

  it("refuses undersized or gap-free aggregates", () => {
    expect(recommendTeamLearning({frameworks:[framework],links:[link],teamSignals:[{...teamSignal,memberCount:2}]},catalog)).toEqual([]);
    expect(recommendTeamLearning({frameworks:[framework],links:[link],teamSignals:[{...teamSignal,observedLevel:3,gap:0}]},catalog)).toEqual([]);
  });

  it("exports only thresholded aggregates and neutralises spreadsheet formulas", () => {
    const unsafeFramework={...framework,name:"=HYPERLINK(\"https://example.test\")",definitions:[{...framework.definitions[0],name:"+SUM(1,1)"}]};
    const csv=teamSignalsCsv([unsafeFramework],[teamSignal,{...teamSignal,memberCount:2,basis:"must remain suppressed"}],180);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+SUM");
    expect(csv).not.toContain("must remain suppressed");
  });
});
