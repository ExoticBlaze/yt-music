import ts from 'typescript';
import { mkdir } from 'node:fs/promises';

await mkdir('plugin-sdk/dist', { recursive: true });
const options = {
  declaration: true,
  emitDeclarationOnly: true,
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  outDir: 'plugin-sdk/dist',
  rootDir: '.',
};
const program = ts.createProgram(['plugin-sdk/index.ts'], options);
const emitted = program.emit();
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics];
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (value) => value,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
  process.exit(1);
}
console.log('Plugin SDK declarations built.');
