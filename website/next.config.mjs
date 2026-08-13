import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This site is a subfolder of the Reframe app repo, which has its own
  // lockfile. Pin the root here so the bundler never walks up into the
  // Electron project when inferring the workspace.
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url))
  }
};

export default nextConfig;
