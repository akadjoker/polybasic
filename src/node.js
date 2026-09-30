// Node.js glue for the engine: files named by a program (models, textures)
// are read from disk, relative to the program's .pb file, and physics runs
// on Rapier. Kept apart from
// src/index.js so the browser build never sees node:fs.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Engine options for a program stored in `file`.
export function nodeEngineOptions(file)
{
  return {
    baseUrl: pathToFileURL(resolve(file)).href,
    loadFile: (url) => readFile(url.startsWith('file:') ? fileURLToPath(url) : url),
    loadPhysics: loadRapier
  };
}

// A ready Rapier backend, loaded the first time a program needs physics.
export async function loadRapier()
{
  const { RapierBackend } = await import('./engine/physics/rapier/rapier-backend.js');
  return RapierBackend.create();
}
