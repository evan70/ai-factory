import path from 'path';
import fs from 'fs-extra';
import { readJsonFile, removeDirectory, ensureDir } from '../utils/fs.js';

export interface ExtensionInjection {
  target: string;
  position: 'append' | 'prepend';
  file: string;
}

export interface ExtensionCommand {
  name: string;
  description: string;
  module: string;
}

export interface ExtensionAgentDef {
  id: string;
  displayName: string;
  configDir: string;
  skillsDir: string;
  settingsFile: string | null;
  supportsMcp: boolean;
  skillsCliAgent: string | null;
}

export interface ExtensionMcpServer {
  key: string;
  template: string;
  instruction?: string;
}

export interface ExtensionManifest {
  name: string;
  version: string;
  description?: string;
  commands?: ExtensionCommand[];
  agents?: ExtensionAgentDef[];
  injections?: ExtensionInjection[];
  skills?: string[];
  mcpServers?: ExtensionMcpServer[];
}

const EXTENSIONS_DIR = 'extensions';
const SAFE_NAME_PATTERN = /^[a-zA-Z0-9_@][\w.@/-]*$/;

export function validateExtensionName(name: string): void {
  if (!SAFE_NAME_PATTERN.test(name) || name.includes('..') || path.isAbsolute(name)) {
    throw new Error(`Invalid extension name: "${name}". Names must be alphanumeric (with -, _, @, /) and cannot contain ".." or absolute paths.`);
  }
}

export function getExtensionsDir(projectDir: string): string {
  return path.join(projectDir, '.ai-factory', EXTENSIONS_DIR);
}

export async function loadExtensionManifest(extensionDir: string): Promise<ExtensionManifest | null> {
  const manifestPath = path.join(extensionDir, 'extension.json');
  const manifest = await readJsonFile<ExtensionManifest>(manifestPath);
  if (!manifest || !manifest.name || !manifest.version) {
    return null;
  }
  validateExtensionName(manifest.name);
  return manifest;
}

export async function loadAllExtensions(
  projectDir: string,
  registeredNames: string[],
): Promise<{ dir: string; manifest: ExtensionManifest }[]> {
  const extensionsDir = getExtensionsDir(projectDir);
  const results: { dir: string; manifest: ExtensionManifest }[] = [];

  for (const name of registeredNames) {
    try {
      validateExtensionName(name);
    } catch {
      continue;
    }
    const extDir = path.join(extensionsDir, name);
    const manifest = await loadExtensionManifest(extDir);
    if (manifest) {
      results.push({ dir: extDir, manifest });
    }
  }

  return results;
}

function isGitUrl(source: string): boolean {
  return source.startsWith('git+') ||
    source.startsWith('git://') ||
    source.endsWith('.git') ||
    source.includes('github.com/') ||
    source.includes('gitlab.com/');
}

function isLocalPath(source: string): boolean {
  return source.startsWith('./') || source.startsWith('/') || source.startsWith('../') || path.isAbsolute(source);
}

export async function installExtensionFromLocal(projectDir: string, sourcePath: string): Promise<ExtensionManifest> {
  const resolvedSource = path.resolve(sourcePath);
  const manifest = await loadExtensionManifest(resolvedSource);
  if (!manifest) {
    throw new Error(`Invalid extension: no valid extension.json found in ${resolvedSource}`);
  }

  // validateExtensionName already called inside loadExtensionManifest
  const targetDir = path.join(getExtensionsDir(projectDir), manifest.name);
  await ensureDir(targetDir);
  await fs.copy(resolvedSource, targetDir, { overwrite: true });

  return manifest;
}

export async function installExtensionFromNpm(projectDir: string, packageName: string): Promise<ExtensionManifest> {
  const { execFileSync } = await import('child_process');
  const tmpDir = path.join(getExtensionsDir(projectDir), '.tmp-install');
  await ensureDir(tmpDir);

  try {
    execFileSync('npm', ['pack', packageName, '--pack-destination', tmpDir], { stdio: 'pipe' });

    const files = await fs.readdir(tmpDir);
    const tgzFile = files.find(f => f.endsWith('.tgz'));
    if (!tgzFile) throw new Error('npm pack produced no output');

    const extractDir = path.join(tmpDir, 'extracted');
    await ensureDir(extractDir);
    execFileSync('tar', ['-xzf', path.join(tmpDir, tgzFile), '-C', extractDir], { stdio: 'pipe' });

    const packageDir = path.join(extractDir, 'package');
    const manifest = await loadExtensionManifest(packageDir);
    if (!manifest) {
      throw new Error(`Invalid extension: no valid extension.json in ${packageName}`);
    }

    // validateExtensionName already called inside loadExtensionManifest
    const targetDir = path.join(getExtensionsDir(projectDir), manifest.name);
    await ensureDir(targetDir);
    await fs.copy(packageDir, targetDir, { overwrite: true });

    return manifest;
  } finally {
    await removeDirectory(tmpDir);
  }
}

export async function installExtensionFromGit(projectDir: string, url: string): Promise<ExtensionManifest> {
  const { execFileSync } = await import('child_process');
  const tmpDir = path.join(getExtensionsDir(projectDir), '.tmp-clone');

  try {
    await removeDirectory(tmpDir);
    const cleanUrl = url.replace(/^git\+/, '');
    execFileSync('git', ['clone', '--depth', '1', cleanUrl, tmpDir], { stdio: 'pipe' });

    const manifest = await loadExtensionManifest(tmpDir);
    if (!manifest) {
      throw new Error(`Invalid extension: no valid extension.json in ${url}`);
    }

    // validateExtensionName already called inside loadExtensionManifest
    const targetDir = path.join(getExtensionsDir(projectDir), manifest.name);
    await ensureDir(targetDir);

    // Copy everything except .git
    const entries = await fs.readdir(tmpDir);
    for (const entry of entries) {
      if (entry === '.git') continue;
      await fs.copy(path.join(tmpDir, entry), path.join(targetDir, entry), { overwrite: true });
    }

    return manifest;
  } finally {
    await removeDirectory(tmpDir);
  }
}

export async function installExtension(projectDir: string, source: string): Promise<ExtensionManifest> {
  if (isLocalPath(source)) {
    return installExtensionFromLocal(projectDir, source);
  }
  if (isGitUrl(source)) {
    return installExtensionFromGit(projectDir, source);
  }
  return installExtensionFromNpm(projectDir, source);
}

export async function removeExtensionFiles(projectDir: string, name: string): Promise<void> {
  validateExtensionName(name);
  const targetDir = path.join(getExtensionsDir(projectDir), name);
  // Verify target stays within extensions dir
  const extensionsDir = getExtensionsDir(projectDir);
  if (!path.resolve(targetDir).startsWith(path.resolve(extensionsDir) + path.sep)) {
    throw new Error(`Extension path escapes extensions directory: "${name}"`);
  }
  await removeDirectory(targetDir);
}
