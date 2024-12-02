import fs from 'fs';
import path from 'path';
import packageJson from './package.json' with { type: 'json' };

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const buildInfo = `
  export const name = '${packageJson.name}';
  export const version = '${packageJson.version}';
  export const description = '${packageJson.description}';
  export default { name, version, description };
`;

fs.writeFileSync(path.resolve(__dirname, 'src', 'build-info.ts'), buildInfo);
