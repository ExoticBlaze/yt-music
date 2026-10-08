import { spawn } from 'node:child_process';
import electron from 'electron';
import { watch } from 'node:fs';
import { buildPlugin } from './build-plugins.mjs';

const compile = () =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Build failed'))));
  });
await compile();
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const appArguments = ['.', '--development', ...process.argv.slice(2)];
let app = spawn(electron, appArguments, { stdio: 'inherit', env: environment });
let rebuilding = false;
let timer;
for (const root of ['src', 'plugins']) {
  watch(root, { recursive: true }, (_event, filename) => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (rebuilding) return;
      rebuilding = true;
      try {
        if (root === 'plugins' && filename) {
          await buildPlugin(filename.replaceAll('\\', '/').split('/')[0]);
          return;
        }
        await compile();
        app.kill();
        app = spawn(electron, appArguments, { stdio: 'inherit', env: environment });
      } catch (error) {
        console.error(error);
      } finally {
        rebuilding = false;
      }
    }, 400);
  });
}
process.on('SIGINT', () => {
  app.kill();
  process.exit();
});
