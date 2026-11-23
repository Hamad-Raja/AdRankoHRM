import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// This deployment-specific build must never bake Render's cross-site origin
// into the browser client. Other builds and local dev retain their environment.
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const result = spawnSync(process.execPath, [vite, 'build'], {
  stdio: 'inherit', env: {...process.env, VITE_API_URL: '/api'},
});
if (result.error) { console.error('Unable to run the Vercel frontend build.'); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;

