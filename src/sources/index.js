import { createEliSource } from './eli.js';
import { createRssSource } from './rss.js';

const FACTORIES = { eli: createEliSource, rss: createRssSource };

export function buildSources(cfg) {
  return (cfg.sources ?? [])
    .filter((s) => s.enabled)
    .map((s) => {
      const make = FACTORIES[s.type];
      if (!make) throw new Error(`Nieznany typ źródła: ${s.type} (${s.id})`);
      return make(s);
    });
}
