// Stage 1: resume intake and AI screening (docs/ai-hiring/06-stage1-screening.md).
// Real code: file validation, PDF/DOCX/TXT text extraction on the real fixture files, the fit scorer's
// post-processing. The language model is replaced by scripted answers, so results are repeatable.
import assert from "node:assert/strict";
import {
  MAX_RESUME_BYTES, buildParsedData, extractResumeText, validateResumeFile,
} from "../../libs/hiring/resume-text";
import { postProcessFit, scoreCandidateFit, scrubName, skillAppearsIn } from "../../libs/hiring/fit-scorer";
import { FIT_SYSTEM, buildFitUser, stripPersonalFields } from "../../libs/ai/prompts/fit";
import {
  EXPECTED_SKILLS, REQUIRED, byGroup, candidateFrom, job, list, readResume, resumeText,
} from "./fixtures";
import { tripwireAttempts } from "./tripwire";

async function skillsOf(file) {
  const entry = EXPECTED_SKILLS[file];
  const candidate = await candidateFrom(file, entry.name);
  return { entry, result: postProcessFit({ fitScore: 50 }, { job, candidate }) };
}

function checkGroup(group) {
  return async () => {
    const lines = [];
    for (const [file, expected] of byGroup(group)) {
      const { result } = await skillsOf(file);
      assert.deepEqual(result.skillMatch.matched, expected.matched, `${file}: matched skills`);
      assert.deepEqual(result.skillMatch.missing, expected.missing, `${file}: missing skills`);
      lines.push(`${expected.name} ${result.skillMatch.matched.length}/${REQUIRED.length}`);
    }
    return lines.join(" · ");
  };
}

export default {
  id: 1,
  title: "Resume intake and AI screening",
  tier: "offline",
  intro: "A candidate applies with a file. Is it accepted, read correctly, and scored without trusting the AI blindly?",
  cases: [
    {
      id: "S1-01",
      title: "Upload rules: PDF, DOCX, TXT up to 5 MB are accepted; everything else is refused",
      requirement: "Only safe, expected file types and sizes reach the parser (06 §1).",
      input: "resume.pdf, CV.DOCX, notes.txt, virus.exe, empty.pdf (0 bytes), huge.pdf (6 MB)",
      expect: "first three accepted (case-insensitive), last three refused with a reason",
      run: async () => {
        const ok = ["resume.pdf", "CV.DOCX", "notes.txt"].map((filename) => validateResumeFile({ filename, size: 1000 }));
        assert.deepEqual(ok, [null, null, null]);
        assert.match(validateResumeFile({ filename: "virus.exe", size: 1000 }), /PDF, DOCX or TXT/);
        assert.match(validateResumeFile({ filename: "empty.pdf", size: 0 }), /empty/);
        assert.match(validateResumeFile({ filename: "huge.pdf", size: MAX_RESUME_BYTES + 1 }), /5 MB/);
        return "accepted: pdf, DOCX, txt · refused: .exe (type), 0 bytes (empty), 6 MB (too big)";
      },
    },
    {
      id: "S1-02",
      title: "A real PDF resume is read (Ayesha Khan, 2 pages of text)",
      requirement: "The PDF parser must return the actual words, not file metadata.",
      input: "tests/fixtures/resumes/strong-1-ayesha-khan.pdf",
      expect: "method pdf-parse, text contains Kubernetes, Terraform and her job title",
      run: async () => {
        const { text, method } = await extractResumeText({ buffer: readResume("strong-1-ayesha-khan.pdf"), filename: "strong-1-ayesha-khan.pdf" });
        assert.equal(method, "pdf-parse");
        for (const word of ["Kubernetes", "Terraform", "Senior DevOps Engineer"]) assert.ok(text.includes(word), `missing "${word}"`);
        return `${method}, ${text.length} characters, contains the three expected terms`;
      },
    },
    {
      id: "S1-03",
      title: "A real DOCX resume is read (Sara Ahmed)",
      requirement: "Word resumes are supported through mammoth.",
      input: "tests/fixtures/resumes/strong-3-sara-ahmed.docx",
      expect: "method mammoth, text contains EKS clusters and Terraform",
      run: async () => {
        const { text, method } = await extractResumeText({ buffer: readResume("strong-3-sara-ahmed.docx"), filename: "strong-3-sara-ahmed.docx" });
        assert.equal(method, "mammoth");
        assert.ok(text.includes("EKS clusters") && text.includes("Terraform"));
        return `${method}, ${text.length} characters`;
      },
    },
    {
      id: "S1-04",
      title: "A scanned (image-only) PDF is flagged instead of guessed at",
      requirement: "No text means no scoring: the application is kept and marked unreadable (06 §1).",
      input: "tests/fixtures/resumes/unreadable-scanned.pdf",
      expect: "0 characters extracted; parsedData.parseError set; no AI call made",
      run: async () => {
        const before = tripwireAttempts();
        const text = await resumeText("unreadable-scanned.pdf");
        const parsed = await buildParsedData({ buffer: readResume("unreadable-scanned.pdf"), filename: "unreadable-scanned.pdf" });
        assert.equal(text.length, 0);
        assert.equal(parsed.parseError, "Could not extract readable text from resume");
        assert.equal(tripwireAttempts(), before, "the AI must not be called for an unreadable file");
        return `0 characters → parseError "${parsed.parseError}"`;
      },
    },
    {
      id: "S1-05",
      title: "Strong resumes (PDF, TXT, DOCX): all 6 required skills are found",
      requirement: "Matched skills are recomputed from the resume text, not taken from the AI.",
      input: "Ayesha Khan (PDF), Bilal Qureshi (TXT), Sara Ahmed (DOCX) against Docker, Kubernetes, AWS, CI/CD, Terraform, Linux",
      expect: "6 of 6 matched for each, none missing (expected list written by reading the resumes)",
      run: checkGroup("strong"),
    },
    {
      id: "S1-06",
      title: "Partial resumes: exactly the skills they show are found, the gaps are named",
      requirement: "A partial match must show what is missing, so the recruiter can see why the score is middling.",
      input: "Hamza Sheikh, Fatima Noor, Usman Tariq",
      expect: "Hamza and Usman: Docker, AWS, Linux. Fatima: Linux only. All other skills listed as missing",
      run: checkGroup("partial"),
    },
    {
      id: "S1-07",
      title: "Unrelated resumes (designer, accountant): no required skill is found",
      requirement: "A resume for a different profession must not accidentally match.",
      input: "Zara Malik (graphic designer), Omar Farooq (accountant)",
      expect: "0 of 6 matched, all six listed as missing",
      run: checkGroup("unrelated"),
    },
    {
      id: "S1-08",
      title: "Skill names are matched as whole terms, with synonyms",
      requirement: "k8s means Kubernetes, but Java must not match JavaScript (06 §2).",
      input: "k8s→Kubernetes, Amazon Web Services→AWS, postgres→PostgreSQL, Java vs JavaScript, Go vs Google",
      expect: "synonyms match; look-alike substrings do not",
      run: async () => {
        assert.equal(skillAppearsIn("Kubernetes", "Operates k8s clusters"), true);
        assert.equal(skillAppearsIn("AWS", "Amazon Web Services certified"), true);
        assert.equal(skillAppearsIn("PostgreSQL", "postgres 14"), true);
        assert.equal(skillAppearsIn("Java", "JavaScript developer"), false);
        assert.equal(skillAppearsIn("Go", "good at Google Docs"), false);
        return "k8s ✓ · Amazon Web Services ✓ · postgres ✓ · Java≠JavaScript ✓ · Go≠Google ✓";
      },
    },
    {
      id: "S1-09",
      title: "A skill the AI claims but the resume does not show is not counted",
      requirement: "Hallucination guard: the AI may not give a candidate skills the resume never mentions (06 §2).",
      input: "AI claims the graphic designer Zara Malik has Linux and Ansible; AI claims Bilal Qureshi has Docker and Ansible",
      expect: "Zara: matched none, Linux and Ansible reported as unverified · Bilal: Ansible unverified and not matched, his real Docker kept",
      run: async () => {
        const designer = await candidateFrom("unrelated-1-zara-malik.txt", "Zara Malik");
        const zara = postProcessFit({ fitScore: 80, skillMatch: { matched: ["Linux", "Ansible"] } }, { job, candidate: designer });
        assert.deepEqual(zara.skillMatch.matched, []);
        assert.deepEqual(zara.skillMatch.unverified, ["Linux", "Ansible"]);
        const engineer = await candidateFrom("strong-2-bilal-qureshi.txt", "Bilal Qureshi");
        const bilal = postProcessFit({ fitScore: 85, skillMatch: { matched: ["Docker", "Ansible"] } }, { job, candidate: engineer });
        assert.deepEqual(bilal.skillMatch.unverified, ["Ansible"]);
        assert.ok(!bilal.skillMatch.matched.includes("Ansible") && bilal.skillMatch.matched.includes("Docker"));
        return `Zara: matched=${list(zara.skillMatch.matched)}, unverified=${list(zara.skillMatch.unverified)} · Bilal: unverified=${list(bilal.skillMatch.unverified)}`;
      },
    },
    {
      id: "S1-10",
      title: "Nonsense scores from the AI are repaired, never stored as they came",
      requirement: "The score is always an integer from 0 to 100; unknown verdicts become \"unknown\".",
      input: "fitScore 140.6, -3, \"77.4\", missing; experience verdict \"excellent\"",
      expect: "100, 0, 77, 0; verdict unknown",
      run: async () => {
        const candidate = await candidateFrom("strong-2-bilal-qureshi.txt", "Bilal Qureshi");
        const score = (raw) => postProcessFit(raw, { job, candidate }).fitScore;
        const got = [score({ fitScore: 140.6 }), score({ fitScore: -3 }), score({ fitScore: "77.4" }), score({})];
        assert.deepEqual(got, [100, 0, 77, 0]);
        const verdict = postProcessFit({ fitScore: 50, experienceMatch: { verdict: "excellent" } }, { job, candidate }).experienceMatch.verdict;
        assert.equal(verdict, "unknown");
        return `scores ${got.join(", ")} · verdict "${verdict}"`;
      },
    },
    {
      id: "S1-11",
      title: "The candidate's name never appears in the stored AI explanation",
      requirement: "Screening is name-blind: the explanation says \"the candidate\" (06 §2).",
      input: "AI rationale: \"Bilal Qureshi has strong EKS experience. Bilal also writes Terraform.\"",
      expect: "\"The candidate has strong EKS experience. The candidate also writes Terraform.\"; \"Ali\" does not damage \"Alibaba\"",
      run: async () => {
        const candidate = await candidateFrom("strong-2-bilal-qureshi.txt", "Bilal Qureshi");
        const result = postProcessFit({
          fitScore: 80,
          rationale: "Bilal Qureshi has strong EKS experience. Bilal also writes Terraform.",
          strengths: ["Qureshi led a migration to EKS"],
        }, { job, candidate });
        assert.equal(result.rationale, "The candidate has strong EKS experience. The candidate also writes Terraform.");
        assert.doesNotMatch(JSON.stringify(result), /Bilal|Qureshi/);
        assert.equal(scrubName("Alibaba Cloud experience", "Ali"), "Alibaba Cloud experience");
        return `"${result.rationale}"`;
      },
    },
    {
      id: "S1-12",
      title: "The structured part of the AI prompt carries no personal details",
      requirement: "Name, email, phone and location are stripped; the prompt tells the AI to ignore protected traits.",
      input: "parsed resume of Bilal Qureshi with name, email, phone, location",
      expect: "none of the four fields in the prompt's structured block; system prompt forbids judging gender, age, religion, nationality",
      run: async () => {
        const parsedData = {
          name: "Bilal Qureshi", email: "bilal.qureshi@example.com", phone: "+92 300 0000002", location: "Karachi",
          skills: ["Docker"], yearsExperience: 3, _resumeText: "…",
        };
        const stripped = stripPersonalFields(parsedData);
        for (const field of ["name", "email", "phone", "location"]) assert.equal(field in stripped, false, field);
        const prompt = buildFitUser({ job, candidate: { name: "Bilal Qureshi", parsedData } });
        assert.doesNotMatch(prompt.split("CANDIDATE (resume text")[0], /bilal\.qureshi@example\.com|\+92 300|Karachi/);
        assert.match(FIT_SYSTEM, /never mention name, gender, age, religion, nationality/);
        return "structured block has skills/years only; system prompt contains the protected-traits rule";
      },
    },
    {
      id: "S1-13",
      title: "An unreadable resume scores 0 and goes to manual review without calling the AI",
      requirement: "Never invent a score for a file nobody could read (06 §2).",
      input: "candidate whose parsedData.parseError is set and has no text",
      expect: "fitScore 0, manualReview true, concern \"Resume could not be read\", AI not called",
      run: async () => {
        const candidate = { name: "Scan", parsedData: { parseError: "Could not extract readable text from resume" } };
        const result = await scoreCandidateFit({ job, candidate }, { llm: async () => { throw new Error("must not be called"); } });
        assert.equal(result.fitScore, 0);
        assert.equal(result.manualReview, true);
        assert.deepEqual(result.concerns, ["Resume could not be read"]);
        return `fitScore ${result.fitScore}, manualReview ${result.manualReview}, concern "${result.concerns[0]}"`;
      },
    },
    {
      id: "S1-14",
      title: "AI hiccups are retried twice; a rate limit is not hammered",
      requirement: "Transient failures should not lose a candidate; rate limits go back to the queue (06 §2, 13).",
      input: "AI fails twice then answers 70 · AI always down · AI answers 429 (rate limit)",
      expect: "3 calls then score 70 · 3 calls then error · 1 call then rate_limit error",
      run: async () => {
        const candidate = await candidateFrom("strong-2-bilal-qureshi.txt", "Bilal Qureshi");
        const sleep = async () => {};
        let calls = 0;
        const flaky = async () => { calls += 1; if (calls < 3) throw Object.assign(new Error("boom"), { code: "upstream" }); return { fitScore: 70 }; };
        const recovered = await scoreCandidateFit({ job, candidate }, { llm: flaky, sleep });
        assert.equal(recovered.fitScore, 70);
        assert.equal(calls, 3);

        calls = 0;
        await assert.rejects(scoreCandidateFit({ job, candidate }, { llm: async () => { calls += 1; throw Object.assign(new Error("down"), { code: "upstream" }); }, sleep }), /down/);
        const downCalls = calls;

        calls = 0;
        await assert.rejects(scoreCandidateFit({ job, candidate }, { llm: async () => { calls += 1; throw Object.assign(new Error("429"), { code: "rate_limit" }); }, sleep }), { code: "rate_limit" });
        assert.equal(downCalls, 3);
        assert.equal(calls, 1);
        return `flaky → recovered after 3 calls · down → ${downCalls} calls then error · rate limit → ${calls} call`;
      },
    },
  ],
};
