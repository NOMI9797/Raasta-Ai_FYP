// The stand-in for Indeed's employer area is the posting engine's practice site (libs/poster/practice): the tests drive the
// same pages a person sees in a practice run. Nothing leaves the machine: every other address is refused.
export { installPracticeSite as installMockIndeed } from "../../../libs/poster/practice/site";
