// Production wiring for the session manager: Postgres repository, Groq LLM calls, ai-engine TTS,
// Deepgram/Whisper STT, Redis pub/sub and the hiring queue. Relative imports only.
import * as repository from "../../libs/interview/repository";
import { analyzeAnswer } from "../../libs/interview/answer-analyzer";
import { scoreAnswer } from "../../libs/interview/answer-scorer";
import { generateFollowUp } from "../../libs/interview/follow-up";
import { synthesize } from "../../libs/interview/tts-client";
import { createStt } from "../../libs/interview/stt";
import { publishInterviewEvent } from "../../libs/interview/events";
import { enqueue } from "../../libs/hiring/queue";
import { detectSpokenLanguage } from "../../libs/ai/llm";

export function createEngineDeps({ log }) {
  return {
    repo: {
      loadSessionContext: (id) => repository.loadSessionContext(id),
      ensureQuestionSnapshot: (interview) => repository.ensureQuestionSnapshot(interview),
      markStarted: (interview, options) => repository.markStarted(interview, options),
      appendTurn: (id, turn) => repository.appendTurn(id, turn),
      createResponse: (id, response) => repository.createResponse(id, response),
      updateResponseScore: (responseId, result) => repository.updateResponseScore(responseId, result),
      saveState: (id, state) => repository.saveState(id, state),
      recordIntegrityEvent: (id, event) => repository.recordIntegrityEvent(id, event),
      complete: (interview, options) => repository.completeInterview(interview, options),
      abandon: (interview, options) => repository.abandonInterview(interview, options),
    },
    analyze: (answer, question, context) => analyzeAnswer(answer, question, context),
    score: (answer, question) => scoreAnswer(answer, question),
    followUp: (context) => generateFollowUp(context),
    tts: (text, options) => synthesize(text, options),
    createStt: (handlers) => createStt(handlers),
    // Which language was spoken: only asked about speech the transcript makes doubtful (libs/interview/language.js)
    detectLanguage: (wavBuffer) => detectSpokenLanguage({ wavBuffer }),
    publish: (interviewId, event) => publishInterviewEvent(interviewId, event),
    enqueue: (type, payload) => enqueue(type, payload),
    log,
  };
}
