// Validation for saved agent configs (agent_configs). Relative imports only.
import { normaliseMode } from "./policy";
import { RECRUITER_PIPELINE } from "./runs";
import { sanitiseRecruiterConfig } from "./launch";

const SALES_MODES = ["semi_auto", "full_auto"];

/**
 * Mode and config for a pipeline. Recruiter agents use assisted / autopilot (older names are
 * mapped); sales agents keep semi_auto / full_auto. Throws RunError on invalid recruiter settings.
 */
export function normaliseAgentConfig(pipelineType, { mode, config } = {}) {
  if (pipelineType === RECRUITER_PIPELINE) {
    return {
      mode: mode === undefined ? undefined : normaliseMode(mode),
      config: config === undefined ? undefined : sanitiseRecruiterConfig(config),
    };
  }
  return {
    mode: mode === undefined ? undefined : SALES_MODES.includes(mode) ? mode : "semi_auto",
    config,
  };
}
