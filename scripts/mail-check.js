/**
 * Checks the Mailgun settings and, given an address, sends one real test email through them.
 *
 *   npm run mail:check                    # what is set (never prints the key)
 *   npm run mail:check -- you@example.com # also sends a test invitation to that address
 *
 * A sandbox domain only delivers to authorized recipients: add the address in the Mailgun dashboard first.
 */
import "../libs/load-env";
import { MailError, mailgunSettings, sendEmail } from "../libs/mailgun";
import { inviteEmail } from "../libs/hiring/emails";

const settings = mailgunSettings();
const yes = (value) => (value ? "set" : "NOT SET");

console.log("Mailgun settings");
console.log(`  MAILGUN_API_KEY   ${yes(settings.apiKey)}`);
console.log(`  MAILGUN_DOMAIN    ${settings.domain || "NOT SET"}${settings.sandbox ? "  (sandbox: authorized recipients only)" : ""}`);
console.log(`  region / API      ${settings.region} / ${settings.url}`);
console.log(`  sender            ${settings.from || "(needs MAILGUN_DOMAIN)"}`);

if (!settings.configured) {
  console.error(`\nNot ready: ${settings.missing.join(" and ")} missing. Add ${settings.missing.length > 1 ? "them" : "it"} to .env.local (see .env.example).`);
  process.exit(1);
}

const to = process.argv[2];
if (!to) {
  console.log("\nSettings are complete. Add an address to send a test email: npm run mail:check -- you@example.com");
  process.exit(0);
}

const message = inviteEmail({
  candidateName: "Test Candidate",
  jobTitle: "Test role (email check)",
  link: `${(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:8085").replace(/\/$/, "")}/interview/this-is-only-a-test-link`,
  expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
  maxMinutes: 25,
  recordVideo: true,
  trackBehavior: true,
  hiringTeam: "Raasta-AI",
});

sendEmail({ to, ...message, subject: `[Test] ${message.subject}`, tags: ["mail-check"] })
  .then((result) => console.log(`\nSent to ${to}. Mailgun says: ${result.message || "queued"} ${result.id || ""}`))
  .catch((error) => {
    console.error(`\n${error.message}`);
    if (error instanceof MailError && error.hint) console.error(`Hint: ${error.hint}`);
    process.exit(1);
  });
