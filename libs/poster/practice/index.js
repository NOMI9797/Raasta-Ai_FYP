// Practice sites, one per platform: stand-ins for the employer areas that the posting engine can run against with no account and
// no network (docs/ai-hiring/19, section 5f). Relative imports only.
import { installPracticeSite as installIndeed } from "./site";
import { installRozeePracticeSite as installRozee } from "./rozee-site";

const SITES = { indeed: installIndeed, rozee: installRozee };

/** Install the practice site of a platform on a browser context. Throws for a platform that has none. */
export async function installPractice(context, platform, options = {}) {
  const install = SITES[platform];
  if (!install) throw new Error(`There is no practice site for ${platform}`);
  return install(context, options);
}

export { installIndeed as installIndeedPractice, installRozee as installRozeePractice };
