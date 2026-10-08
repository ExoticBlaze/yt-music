import { parentPort, workerData } from 'node:worker_threads';
import { FiltersEngine } from '@ghostery/adblocker';

const engine = FiltersEngine.parse(String(workerData), {
  loadCosmeticFilters: false,
  loadGenericCosmeticsFilters: false,
  loadCSPFilters: false,
  loadExtendedSelectors: false,
  enableHtmlFiltering: false,
});
parentPort?.postMessage({
  bytes: engine.serialize(),
  count: engine.getFilters().networkFilters.length,
});
