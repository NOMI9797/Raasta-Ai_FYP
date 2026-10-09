// Guard for the offline stages: if any case tries to reach the real language model, it fails loudly
// and the run is marked as failed. This is how the demo proves "stages 1-5 never use the network".
import { setLlmClient } from "../../libs/ai/llm";

let attempts = 0;

/** Make every call to the language model throw (and count it). Does not reset the counter. */
export function installTripwire() {
  setLlmClient({
    chat: {
      completions: {
        create: async () => {
          attempts += 1;
          throw new Error("TRIPWIRE: an offline demo case tried to call the language model");
        },
      },
    },
  });
}

export const resetTripwire = () => { attempts = 0; };

/** Back to the real client (for the live stage). */
export function removeTripwire() {
  setLlmClient(null);
}

export const tripwireAttempts = () => attempts;
