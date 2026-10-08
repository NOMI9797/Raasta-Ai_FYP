// Choosing the closest of the skills a platform suggests. Rozee.pk's wizard offers a list of skills for the job title in its own
// words ("Containerization", "Version Control Systems") and a job's skills are in the recruiter's ("Docker", "Git"), so an exact
// match is rare. This ranks the suggestions by how close they are to the job: its own skills first (the same words, or the same
// idea, such as Docker and Containerization), then its title and description, and finally the order the platform gave them in,
// which is already by relevance to the title. Pure functions, no browser: tested on their own.
// Relative imports only (also used by the engine process).

// Ideas that different words stand for. A word or phrase of a job's skill and a word or phrase of a suggestion that share an idea
// are close, whatever the wording.
const CONCEPTS = {
  containers: ["docker", "podman", "container", "containers", "containerization", "containerisation", "container orchestration"],
  orchestration: ["kubernetes", "k8s", "helm", "container orchestration", "openshift", "orchestration"],
  vcs: ["git", "github", "gitlab", "bitbucket", "svn", "mercurial", "version control", "version control systems", "source control", "source code management"],
  cicd: ["ci/cd", "ci cd", "cicd", "continuous integration", "continuous deployment", "continuous delivery", "jenkins", "github actions", "gitlab ci", "travis", "travis ci", "circleci", "pipeline", "pipelines", "build and release", "build and release management", "release management", "deployment automation"],
  scripting: ["bash", "shell", "shell scripting", "powershell", "scripting", "automation scripting", "automation", "python scripting", "sh"],
  linux: ["linux", "unix", "ubuntu", "centos", "debian", "red hat", "rhel", "operating systems", "operating system", "system administration", "sysadmin", "linux administration"],
  cloud: ["aws", "amazon web services", "azure", "gcp", "google cloud", "cloud", "cloud computing", "cloud platforms", "cloud computing platforms", "cloud infrastructure", "ec2", "s3"],
  iac: ["terraform", "ansible", "cloudformation", "pulumi", "puppet", "chef", "infrastructure as code", "configuration management", "iac"],
  networking: ["networking", "network", "networks", "networking basics", "networking fundamentals", "tcp/ip", "tcp ip", "dns", "http", "load balancing", "network administration", "firewalls", "vpn"],
  monitoring: ["monitoring", "logging", "observability", "prometheus", "grafana", "elk", "elk stack", "datadog", "splunk", "monitoring and logging", "new relic"],
  database: ["sql", "mysql", "postgres", "postgresql", "mongodb", "database", "databases", "nosql", "rdbms", "database management", "oracle", "redis"],
  javascript: ["javascript", "js", "typescript", "node", "node.js", "nodejs", "react", "reactjs", "react.js", "angular", "vue", "vue.js", "next.js", "nextjs", "front-end", "frontend", "front end", "web development", "html", "css"],
  backend: ["node.js", "nodejs", "express", "express.js", "api", "apis", "rest", "restful apis", "rest apis", "microservices", "backend", "back-end", "back end", "server-side"],
  python: ["python", "django", "flask", "fastapi", "pandas"],
  java: ["java", "spring", "spring boot", "hibernate", "maven", "jvm"],
  dotnet: [".net", "dotnet", "c#", "asp.net", "csharp"],
  testing: ["testing", "qa", "quality assurance", "test automation", "selenium", "cypress", "playwright", "manual testing", "software testing", "functional testing", "regression testing", "unit testing", "test planning", "test cases", "test case management", "defect tracking"],
  agile: ["agile", "scrum", "kanban", "agile methodologies", "agile testing", "sprint", "sprints"],
  collaboration: ["collaboration", "collaboration tools", "teamwork", "communication", "jira", "confluence", "slack", "team collaboration", "project management"],
  security: ["security", "cybersecurity", "cyber security", "devsecops", "application security", "information security", "penetration testing", "owasp"],
  data: ["data analysis", "data analytics", "analytics", "excel", "power bi", "tableau", "data visualization", "statistics", "reporting", "business intelligence", "bi"],
  marketing: ["seo", "digital marketing", "social media", "social media marketing", "content marketing", "google ads", "email marketing", "marketing"],
  design: ["figma", "ui", "ux", "ui/ux", "design", "photoshop", "illustrator", "graphic design", "adobe xd", "wireframing"],
  devops: ["devops", "sre", "site reliability", "site reliability engineering", "release engineering", "platform engineering"],
  mobile: ["android", "ios", "flutter", "react native", "kotlin", "swift", "mobile development", "mobile app development"],
  ml: ["machine learning", "ml", "ai", "artificial intelligence", "deep learning", "tensorflow", "pytorch", "nlp", "natural language processing", "data science"],
  sales: ["sales", "business development", "crm", "lead generation", "account management", "negotiation", "salesforce"],
  hr: ["recruitment", "recruiting", "hr", "human resources", "talent acquisition", "onboarding", "payroll"],
  finance: ["accounting", "finance", "bookkeeping", "quickbooks", "auditing", "financial reporting", "taxation", "budgeting"],
};

const STOPWORDS = new Set(["and", "or", "the", "of", "for", "to", "in", "a", "an", "with", "on", "at", "by", "as", "is", "are", "be", "we", "you", "our", "your", "will", "this", "that", "from", "have", "has"]);

// Scores a suggestion has to reach to count as close, and how much each kind of closeness is worth
export const STRONG = 40;
const EXACT = 100;
const SHARED_IDEA_WITH_SKILL = 60;
const SKILL_WORDS = 30;
const TITLE_IDEA = 25;
const TITLE_WORDS = 15;
const DESCRIPTION_IDEA = 10;
const DESCRIPTION_WORDS = 5;
const ORDER_BONUS = 5;

const normalise = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9+#./\s-]/g, " ").replace(/\s+/g, " ").trim();

// A word with its endings trimmed, so "testing" and "tests" meet
const stem = (word) => word.replace(/(ization|isation|ations?|ings?|ers?|ies|ed|es|s)$/i, "") || word;
const wordsOf = (text) => normalise(text).split(/[\s/]+/).map((w) => w.replace(/^[.-]+|[.-]+$/g, "")).filter((w) => w.length > 1 && !STOPWORDS.has(w)).map(stem);

const phraseIn = (haystack, phrase) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`).test(haystack);
};

/** The ideas a text stands for: the ids in CONCEPTS whose words or phrases the text contains. */
export function conceptsOf(text) {
  const haystack = ` ${normalise(text)} `;
  const found = new Set();
  for (const [id, phrases] of Object.entries(CONCEPTS)) {
    if (phrases.some((phrase) => phraseIn(haystack.trim(), phrase))) found.add(id);
  }
  return found;
}

const overlap = (a, b) => (a.size === 0 ? 0 : [...a].filter((item) => b.has(item)).length / a.size);

/**
 * Rank suggested skills by how close they are to a job. `suggestions` are the texts in the order the platform showed them.
 * Returns [{ text, score, reason, index }] best first (ties keep the platform's order). `reason` is the job skill (or the title) the
 * suggestion is closest to, for the person reading the run.
 */
export function rankSuggestions({ suggestions, skills = [], title = "", description = "" }) {
  const jobSkills = skills.map((skill) => ({ text: skill, norm: normalise(skill), words: new Set(wordsOf(skill)), ideas: conceptsOf(skill) }));
  const titleWords = new Set(wordsOf(title));
  const titleIdeas = conceptsOf(title);
  const descriptionText = String(description ?? "").slice(0, 3000);
  const descriptionWords = new Set(wordsOf(descriptionText));
  const descriptionIdeas = conceptsOf(descriptionText);
  const count = suggestions.length || 1;

  const ranked = suggestions.map((text, index) => {
    const own = normalise(text);
    const ownWords = new Set(wordsOf(text));
    const ownIdeas = conceptsOf(text);
    let score = 0;
    let reason = "";

    for (const skill of jobSkills) {
      let match = 0;
      if (skill.norm === own) match = EXACT;
      else if ([...ownIdeas].some((idea) => skill.ideas.has(idea))) match = SHARED_IDEA_WITH_SKILL;
      else match = SKILL_WORDS * overlap(ownWords, skill.words);
      if (match > score) {
        score = match;
        reason = skill.text;
      }
    }
    // The skills together are one more place to look: a suggestion made of words that sit in different skills
    const allSkillWords = new Set(jobSkills.flatMap((skill) => [...skill.words]));
    score = Math.max(score, SKILL_WORDS * overlap(ownWords, allSkillWords));

    const closeToTitle = ([...ownIdeas].some((idea) => titleIdeas.has(idea)) ? TITLE_IDEA : 0) + TITLE_WORDS * overlap(ownWords, titleWords);
    if (closeToTitle > 0 && !reason) reason = "the job title";
    score += closeToTitle;
    score += ([...ownIdeas].some((idea) => descriptionIdeas.has(idea)) ? DESCRIPTION_IDEA : 0) + DESCRIPTION_WORDS * overlap(ownWords, descriptionWords);
    score += ORDER_BONUS * ((count - index) / count); // the platform's own order is by relevance to the title

    return { text, score: Math.round(score * 10) / 10, reason, index };
  });

  return ranked.sort((a, b) => b.score - a.score || a.index - b.index);
}

/**
 * Which of the ranked suggestions to choose now. `chosen` is how many skills are already chosen. A close suggestion (score at least
 * STRONG) is chosen as Required. When fewer than `min` skills are chosen in all, the best of the rest are added as Nice to Have: the
 * job has no skills of its own to go by, or the platform's list has little near them, and the platform will not go on without some.
 * Returns [{ text, level: "Required" | "Nice to Have", reason }].
 */
export function pickSkills(ranked, { chosen = 0, max = 6, min = 3 } = {}) {
  const room = Math.max(0, max - chosen);
  if (room === 0) return [];
  const close = ranked.filter((item) => item.score >= STRONG).slice(0, room);
  if (close.length > 0 || chosen >= min) return close.map((item) => ({ text: item.text, level: "Required", reason: item.reason }));
  return ranked.slice(0, Math.min(room, min - chosen)).map((item) => ({ text: item.text, level: "Nice to Have", reason: "" }));
}
