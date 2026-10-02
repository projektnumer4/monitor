import { createEliSource } from './eli.js';
import { createRssSource } from './rss.js';
import { createSejmPrintsSource } from './sejm.js';
import { createEliRegionalSource } from './eli-regional.js';
import { createRclSource } from './rcl.js';
import { createLinksSource } from './links.js';

const FACTORIES = {
  eli: createEliSource,
  rss: createRssSource,
  'sejm-prints': createSejmPrintsSource,
  'eli-regional': createEliRegionalSource,
  rcl: createRclSource,
  links: createLinksSource,
};

export function buildSources(cfg) {
  return (cfg.sources ?? [])
    .filter((s) => s.enabled)
    .map((s) => {
      const make = FACTORIES[s.type];
      if (!make) throw new Error(`Nieznany typ źródła: ${s.type} (${s.id})`);
      if ((s.type === 'rss' || s.type === 'links') && !s.url) throw new Error(`Źródło ${s.id} jest włączone, ale nie ma adresu (url)`);
      return make(s);
    });
}
