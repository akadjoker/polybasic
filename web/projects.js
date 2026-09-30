// Playground projects, kept in the browser (IndexedDB): a project is a set
// of files (PolyBasic sources, images, models) with one main program.
//
//   projects  { id, name, main, created, modified, paths: [path] }
//   files     { project, path, data: Uint8Array }   key [project, path]
//
// Files are stored one by one, so typing in a program saves that program
// only, not the project's models and textures. When IndexedDB cannot be
// used (a private window, blocked site data) the projects live in memory
// for as long as the page is open, and `persistent` is false.
//
// Paths are relative, use "/" between folders, and are case-sensitive.

const DB_NAME = 'polybasic-playground';
const DB_VERSION = 1;

export const MAX_PATH = 200;

// A path as stored ("lib/util.pb"), or an Error saying what is wrong.
export function cleanPath(input)
{
  const path = String(input).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path) return new Error('a file needs a name');
  if (path.length > MAX_PATH) return new Error(`file names are at most ${MAX_PATH} characters`);
  if (path.startsWith('/')) return new Error('file names are relative to the project (no "/" at the start)');
  for (const part of path.split('/'))
  {
    if (part === '' || part === '.' || part === '..') return new Error(`"${input}" is not a usable file name`);
    if (/[<>:"|?*\u0000-\u001f]/.test(part)) return new Error(`"${part}" has a character file names cannot have`);
  }
  return path;
}

function request(req)
{
  return new Promise((resolve, reject) =>
  {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx)
{
  return new Promise((resolve, reject) =>
  {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('the change was not saved'));
  });
}

function newId()
{
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export class ProjectStore
{
  // Opens the store: IndexedDB when it works, memory otherwise.
  static async open()
  {
    const store = new ProjectStore();
    try
    {
      if (!globalThis.indexedDB) throw new Error('no IndexedDB');
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () =>
      {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: ['project', 'path'] }).createIndex('project', 'project');
      };
      store.db = await request(req);
      store.persistent = true;
    }
    catch
    {
      store.db = null;
      store.persistent = false;
    }
    return store;
  }

  constructor()
  {
    this.db = null;
    this.persistent = false;
    // The memory fallback.
    this.memProjects = new Map();
    this.memFiles = new Map();   // "id\npath" -> data
  }

  // ------------------------------------------------------------ projects

  async list()
  {
    const all = this.db ? await request(this.db.transaction('projects').objectStore('projects').getAll()) : [...this.memProjects.values()].map((p) => ({ ...p }));
    return all.sort((a, b) => b.modified - a.modified);
  }

  async get(id)
  {
    if (!this.db) return this.memProjects.has(id) ? { ...this.memProjects.get(id) } : null;
    return (await request(this.db.transaction('projects').objectStore('projects').get(id))) || null;
  }

  // A new project from files { path: Uint8Array | string }.
  async create(name, files, main = 'main.pb')
  {
    const now = Date.now();
    const entries = Object.entries(files).map(([path, data]) =>
    {
      const clean = cleanPath(path);
      if (clean instanceof Error) throw clean;
      return [clean, typeof data === 'string' ? new TextEncoder().encode(data) : data];
    });
    const paths = entries.map(([p]) => p).sort();
    if (!paths.includes(main)) throw new Error(`the main program "${main}" is not among the files`);
    const project = { id: newId(), name: name || 'Untitled', main, created: now, modified: now, paths };
    if (!this.db)
    {
      this.memProjects.set(project.id, project);
      for (const [path, data] of entries) this.memFiles.set(`${project.id}\n${path}`, data);
      return { ...project };
    }
    const tx = this.db.transaction(['projects', 'files'], 'readwrite');
    tx.objectStore('projects').put(project);
    for (const [path, data] of entries) tx.objectStore('files').put({ project: project.id, path, data });
    await done(tx);
    return project;
  }

  async rename(id, name)
  {
    await this.update(id, (p) =>
    {
      p.name = name;
    });
  }

  async setMain(id, path)
  {
    await this.update(id, (p) =>
    {
      if (!p.paths.includes(path)) throw new Error(`there is no file "${path}"`);
      p.main = path;
    });
  }

  async remove(id)
  {
    if (!this.db)
    {
      this.memProjects.delete(id);
      for (const key of [...this.memFiles.keys()]) if (key.startsWith(`${id}\n`)) this.memFiles.delete(key);
      return;
    }
    const tx = this.db.transaction(['projects', 'files'], 'readwrite');
    tx.objectStore('projects').delete(id);
    const files = tx.objectStore('files');
    const keys = await request(files.index('project').getAllKeys(id));
    for (const key of keys) files.delete(key);
    await done(tx);
  }

  // Changes a project's record with fn(project) and stamps it modified.
  async update(id, fn)
  {
    if (!this.db)
    {
      const p = this.memProjects.get(id);
      if (!p) throw new Error('the project is gone');
      fn(p);
      p.modified = Date.now();
      return { ...p };
    }
    const tx = this.db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    const p = await request(store.get(id));
    if (!p) throw new Error('the project is gone');
    fn(p);
    p.modified = Date.now();
    store.put(p);
    await done(tx);
    return p;
  }

  // --------------------------------------------------------------- files

  // All files of a project: Map path -> Uint8Array.
  async readAll(id)
  {
    if (!this.db)
    {
      const out = new Map();
      for (const [key, data] of this.memFiles) if (key.startsWith(`${id}\n`)) out.set(key.slice(id.length + 1), data);
      return out;
    }
    const rows = await request(this.db.transaction('files').objectStore('files').index('project').getAll(id));
    return new Map(rows.map((r) => [r.path, r.data]));
  }

  // One file of a project, or null.
  async readFile(id, path)
  {
    if (!this.db) return this.memFiles.get(`${id}\n${path}`) || null;
    const row = await request(this.db.transaction('files').objectStore('files').get([id, path]));
    return row ? row.data : null;
  }

  async writeFile(id, path, data)
  {
    const clean = cleanPath(path);
    if (clean instanceof Error) throw clean;
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (!this.db)
    {
      const p = this.memProjects.get(id);
      if (!p) throw new Error('the project is gone');
      this.memFiles.set(`${id}\n${clean}`, bytes);
      if (!p.paths.includes(clean)) p.paths = [...p.paths, clean].sort();
      p.modified = Date.now();
      return clean;
    }
    const tx = this.db.transaction(['projects', 'files'], 'readwrite');
    const projects = tx.objectStore('projects');
    const p = await request(projects.get(id));
    if (!p) throw new Error('the project is gone');
    tx.objectStore('files').put({ project: id, path: clean, data: bytes });
    if (!p.paths.includes(clean)) p.paths = [...p.paths, clean].sort();
    p.modified = Date.now();
    projects.put(p);
    await done(tx);
    return clean;
  }

  async deleteFile(id, path)
  {
    const p = await this.get(id);
    if (!p) throw new Error('the project is gone');
    if (p.main === path) throw new Error('the main program cannot be deleted (make another file the main one first)');
    if (!this.db)
    {
      this.memFiles.delete(`${id}\n${path}`);
      const mp = this.memProjects.get(id);
      mp.paths = mp.paths.filter((x) => x !== path);
      mp.modified = Date.now();
      return;
    }
    const tx = this.db.transaction(['projects', 'files'], 'readwrite');
    tx.objectStore('files').delete([id, path]);
    p.paths = p.paths.filter((x) => x !== path);
    p.modified = Date.now();
    tx.objectStore('projects').put(p);
    await done(tx);
  }

  async renameFile(id, from, to)
  {
    const clean = cleanPath(to);
    if (clean instanceof Error) throw clean;
    const p = await this.get(id);
    if (!p) throw new Error('the project is gone');
    if (!p.paths.includes(from)) throw new Error(`there is no file "${from}"`);
    if (from === clean) return clean;
    if (p.paths.includes(clean)) throw new Error(`there is already a file "${clean}"`);
    const data = await this.readFile(id, from);
    p.paths = [...p.paths.filter((x) => x !== from), clean].sort();
    if (p.main === from) p.main = clean;
    p.modified = Date.now();
    if (!this.db)
    {
      this.memFiles.delete(`${id}\n${from}`);
      this.memFiles.set(`${id}\n${clean}`, data);
      this.memProjects.set(id, p);
      return clean;
    }
    const tx = this.db.transaction(['projects', 'files'], 'readwrite');
    const files = tx.objectStore('files');
    files.delete([id, from]);
    files.put({ project: id, path: clean, data });
    tx.objectStore('projects').put(p);
    await done(tx);
    return clean;
  }
}
