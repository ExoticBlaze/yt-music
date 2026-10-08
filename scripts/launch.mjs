import { spawn } from 'node:child_process';
import electron from 'electron';

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: environment,
});
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGINT', () => child.kill());
