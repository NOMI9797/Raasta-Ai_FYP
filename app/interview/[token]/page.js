import InterviewApp from "./components/InterviewApp";

// /interview/[token] — public candidate interview room (docs/ai-hiring/10-interview-room.md)
export default function InterviewPage({ params }) {
  return <InterviewApp token={params.token} />;
}
