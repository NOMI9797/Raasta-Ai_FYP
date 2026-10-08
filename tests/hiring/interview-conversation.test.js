// Conversation hygiene: echo of the interviewer's voice, speech-to-text junk, and "end the interview".
// The sample lines are taken from a real interview transcript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stripEchoes, stripLeadingEcho } from "../../libs/interview/echo-guard";
import { detectEndRequest, isDecline } from "../../libs/interview/intent";
import { cleanTranscript } from "../../libs/interview/stt/clean";
import { isSpeechSegment } from "../../libs/ai/llm";

const Q1 = "Walk me through your background and why this role interests you.";
const FOLLOW_UP = "Can you walk me through a specific project where you built a full‑stack Node.js/React application, containerized it with Docker (or Kubernetes), deployed it on";

test("echo: the question read back at the start of an answer is cut off", () => {
  const heard = "Walk me through your background and why this role interests you. Mm-hmm. I'm going to go. Thank you. In my background I am a developer of Node.js and react.js";
  const { text, stripped } = stripLeadingEcho(heard, Q1);
  assert.equal(stripped, true);
  assert.ok(text.startsWith("Mm-hmm. I'm going to go."), text);
  assert.equal(cleanTranscript(text).startsWith("I'm going to go."), true);
});

test("echo: speech-to-text spellings of the same sentence still match", () => {
  const heard = "Olha aí. Can you walk me through a specific project where you built a full stack node dot js slash react application containerized it with Docker or Kubernetes deployed it on? I have worked in a project where I developed a task management app";
  const { text, stripped } = stripLeadingEcho(heard, FOLLOW_UP);
  assert.equal(stripped, true);
  assert.equal(text, "I have worked in a project where I developed a task management app");
});

test("echo: 'Welcome back' prefix and several echoes in one buffer", () => {
  const spoken = ["Welcome back, let's continue. Can you describe the biggest technical challenge you encountered when containerizing and deploying the task-management app to AWS?", Q1];
  const heard = "Welcome back let's continue can you describe the biggest technical challenge you encountered when containerizing and deploying the task management app to AWS yeah I encountered some technical issues with environment variables";
  const { text } = stripEchoes(heard, spoken);
  assert.equal(text, "yeah I encountered some technical issues with environment variables");
});

test("echo: an answer that is only the echo disappears, a real answer is left alone", () => {
  assert.equal(stripEchoes("Walk me through your background and why this role interests you.", [Q1]).text, "");
  const real = "I started as a frontend developer and moved to full stack, which is why this role interests me";
  const kept = stripLeadingEcho(real, Q1);
  assert.equal(kept.stripped, false);
  assert.equal(kept.text, real);
  // too short to tell apart from speech
  assert.equal(stripLeadingEcho("Why do you want this role", "Why this role?").stripped, false);
});

test("transcript junk: foreign words and phantom sentences are removed", () => {
  assert.equal(cleanTranscript("Yeah. Время... Bye."), "Yeah.");
  assert.equal(cleanTranscript("Olha aí."), "");
  // Latin-script foreign words mixed into a sentence can't be told apart by a word filter: the
  // language is locked to English at the source (STT_LANGUAGE); this is only the second line of defence
  assert.equal(cleanTranscript("Obrigado. ありがとうございました Bye. Olha... E aí Okay."), "E aí Okay.");
  assert.equal(cleanTranscript("Thank you. Thank you. Thank you. Thank you."), "");
  assert.equal(cleanTranscript("Mm-hmm. I'm going to go. Thank you. Thank you. I'm not. Okay."), "I'm going to go. I'm not. Okay.");
  assert.equal(cleanTranscript("I used Docker. I used Docker. I used Docker. I used Docker."), "I used Docker. I used Docker.");
  // real speech that happens to contain a thank-you stays
  assert.equal(cleanTranscript("Thank you for having me, I would start with the routes."), "Thank you for having me, I would start with the routes.");
  // other languages are only filtered when English is the interview language
  assert.equal(cleanTranscript("مرحبا Hello", { language: "ur" }), "مرحبا Hello");
});

test("whisper segments: silence and loops are dropped, confident speech is kept", () => {
  assert.equal(isSpeechSegment({ text: " Thank you.", no_speech_prob: 0.9, avg_logprob: -1.1, compression_ratio: 0.8 }), false);
  assert.equal(isSpeechSegment({ text: "thank you thank you thank you", no_speech_prob: 0.05, avg_logprob: -0.3, compression_ratio: 3.1 }), false);
  assert.equal(isSpeechSegment({ text: "mumble", no_speech_prob: 0.1, avg_logprob: -1.5, compression_ratio: 1.2 }), false);
  assert.equal(isSpeechSegment({ text: " I would use Express.", no_speech_prob: 0.02, avg_logprob: -0.25, compression_ratio: 1.1 }), true);
  assert.equal(isSpeechSegment({ text: "   " }), false);
  assert.equal(isSpeechSegment({ text: "no scores given" }), true);
});

test("end request: the real phrasings are recognised", () => {
  for (const phrase of [
    "So actually I want to end the interview here so kindly end my interview. right now.",
    "I said that I want to end the interview, so kindly trigger the ending of the interview.",
    "I again told you that I want to end the interview so please end it.",
    "I want to end this interview so please don't ask me the next question.",
    "Bro Please end this interview.",
    "Can we stop here",
    "please stop",
    "I want to quit",
    "I don't want to continue with this interview",
    "I am done with the interview",
  ]) assert.equal(detectEndRequest(phrase), true, phrase);
});

test("end request: technical answers and ordinary refusals are not end requests", () => {
  for (const phrase of [
    "When the user logs out we end the session and clear the token.",
    "I want to stop the container and restart it with the new image",
    "I am done with my answer",
    "I don't want to answer that.",
    "No, I can't.",
    "In the interview process at my last company we used a take-home test and then a final round with the team lead where we discussed architecture and how we would end up scaling the system over the following year to handle more traffic",
    "",
  ]) assert.equal(detectEndRequest(phrase), false, phrase);
});

test("decline: short refusals skip the follow-up, real answers do not", () => {
  for (const phrase of ["No, I can't.", "I don't want to discuss that.", "No, actually I don't want to answer that.", "I don't know", "Pass", "skip this question please", "No idea"]) {
    assert.equal(isDecline(phrase), true, phrase);
  }
  for (const phrase of [
    "I would use a message queue and a retry policy with exponential backoff because it keeps the services decoupled",
    "I didn't told you the situation so that's not the question that you should be asking.",
    "",
  ]) assert.equal(isDecline(phrase), false, phrase);
});
