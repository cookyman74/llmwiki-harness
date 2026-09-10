/**
 * P2-22 경로 탈출 (DESIGN §3.4 검증 규칙, §5 경로 제한).
 * `..`·구분자·URL 인코딩·빈 slug 는 전부 isError. 대소문자 변형은 alias2slug(소문자 키)로 리다이렉트될 수 있으므로
 * "무엇이 오든 path 가 wiki/ 로 시작하고 .. 을 포함하지 않는다" 를 단언한다(대소문자 무시 FS 에서도 경계 밖 접근 불가).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_VAULT, connect, text, type Connected } from "./p2-helpers.js";

let c: Connected;
beforeAll(async () => {
  c = await connect(FIXTURE_VAULT, { structured: true });
});
afterAll(async () => c.close());

const ESCAPES = ["../CLAUDE.local.md", "../../CLAUDE.md", "wiki2/x", "a\\b", "..", "...", "%2e%2e/x", "%2e%2e%2fx", "..\\..\\CLAUDE.md", "/etc/passwd", "L3-semantic/concept-reranking", "wiki/../CLAUDE.md", "concept-reranking/..", "con..cept", "", " ", "\t"];

describe("P2-22 path escape", () => {
  for (const s of ESCAPES) {
    it(`P2-22 wiki_read_page slug ${JSON.stringify(s)} → isError`, async () => {
      const r = await c.call("wiki_read_page", { slug: s });
      expect(r.isError, `should reject; got: ${text(r).slice(0, 100)}`).toBe(true);
      expect(r.structuredContent).toBeUndefined();
      expect(text(r)).not.toContain("\n");
      expect(text(r)).not.toMatch(/^---/); // 파일 내용이 아닌 오류 메시지
      // §3.4: 검증 단계에서 거부돼야 한다 — "page not found" 로 통과시켜 slug 를 조용히 재해석하면 안 된다
      expect(text(r), `must be a slug validation error, not a lookup miss: ${text(r)}`).not.toMatch(/^page not found/);
    });
    it(`P2-22 wiki_pack slugs [${JSON.stringify(s)}] → isError`, async () => {
      const r = await c.call("wiki_pack", { slugs: [s] });
      expect(r.isError, `should reject; got: ${text(r).slice(0, 100)}`).toBe(true);
    });
  }

  it("P2-22 wiki_pack 은 정상 slug 와 섞여 있어도 탈출 slug 하나로 전체 거부", async () => {
    const r = await c.call("wiki_pack", { slugs: ["concept-reranking", "../CLAUDE.local.md"] });
    expect(r.isError).toBe(true);
    expect(text(r)).not.toContain("## concept-reranking");
  });

  it("P2-22 대소문자 변형 CONCEPT-RERANKING — 응답이 오면 path 는 wiki/ 하위, .. 없음", async () => {
    const r = await c.call("wiki_read_page", { slug: "CONCEPT-RERANKING" });
    if (r.isError) {
      expect(text(r)).toBe("page not found: CONCEPT-RERANKING");
      return;
    }
    const sc = r.structuredContent as Record<string, unknown>;
    expect(typeof sc.path).toBe("string");
    expect((sc.path as string).startsWith("wiki/")).toBe(true);
    expect(sc.path).not.toContain("..");
    expect(sc.path).toBe("wiki/L3-semantic/concept-reranking.md");
    expect(sc.slug).toBe("concept-reranking"); // alias2slug 소문자 키 경유 → 실제 slug 로 보고
    expect(sc.resolved_from_alias).toBe(true);
  });

  it("P2-22 정상 slug 의 path 는 항상 wiki/ 상대경로(절대경로·.. 없음)", async () => {
    for (const s of ["concept-reranking", "home-moc", "procedure-no-type", "별칭페이지"]) {
      const r = await c.call("wiki_read_page", { slug: s });
      expect(r.isError, s).toBeFalsy();
      const p = (r.structuredContent as Record<string, unknown>).path as string;
      expect(p.startsWith("wiki/")).toBe(true);
      expect(p).not.toContain("..");
      expect(p).not.toContain("\\");
      expect(p.startsWith("/")).toBe(false);
    }
  });
});
