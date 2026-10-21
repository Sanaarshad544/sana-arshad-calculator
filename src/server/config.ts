import { existsSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

/** The project folder: the nearest parent folder with a package.json. */
export function projectRoot(): string {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}

export interface Config {
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  production: boolean;
}

/** Reads the app's only settings: PORT, DATABASE_URL and SESSION_SECRET. */
export function loadConfig(): Config {
  const envFile = path.join(projectRoot(), '.env');
  if (existsSync(envFile)) loadDotenv({ path: envFile, quiet: true });
  const production = process.env.NODE_ENV === 'production';
  const missing = ['DATABASE_URL', 'SESSION_SECRET'].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing setting${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Copy .env.example to .env, or set them on the server.`);
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be a whole number between 1 and 65535.');
    process.exit(1);
  }
  return {
    port,
    databaseUrl: process.env.DATABASE_URL as string,
    sessionSecret: process.env.SESSION_SECRET as string,
    production,
  };
}
