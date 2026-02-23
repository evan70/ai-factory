import type { AgentInstallation, ExtensionRecord } from './config.js';
import type { ExtensionManifest } from './extensions.js';
import { installSkills, getAvailableSkills, installExtensionSkills, removeExtensionSkills } from './installer.js';
import { stripAllExtensionInjections, stripInjectionsByExtensionName } from './injections.js';

/**
 * Install base skills on all agents.
 */
export async function installSkillsForAllAgents(
  projectDir: string,
  agents: AgentInstallation[],
  skills: string[],
): Promise<void> {
  for (const agent of agents) {
    await installSkills({ projectDir, skillsDir: agent.skillsDir, skills, agentId: agent.id });
  }
}

/**
 * Remove extension skills from all agents. Returns per-agent removed lists.
 */
export async function removeSkillsForAllAgents(
  projectDir: string,
  agents: AgentInstallation[],
  skillNames: string[],
): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>();
  for (const agent of agents) {
    const removed = await removeExtensionSkills(projectDir, agent, skillNames);
    results.set(agent.id, removed);
  }
  return results;
}

/**
 * Install extension skills on all agents. Returns per-agent installed lists.
 */
export async function installExtensionSkillsForAllAgents(
  projectDir: string,
  agents: AgentInstallation[],
  extensionDir: string,
  skillPaths: string[],
  nameOverrides?: Record<string, string>,
): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>();
  for (const agent of agents) {
    const installed = await installExtensionSkills(projectDir, agent, extensionDir, skillPaths, nameOverrides);
    results.set(agent.id, installed);
  }
  return results;
}

/**
 * Collect all replaced skills from extensions, optionally excluding one extension by name.
 */
export function collectReplacedSkills(extensions: ExtensionRecord[], excludeName?: string): Set<string> {
  const result = new Set<string>();
  for (const ext of extensions) {
    if (excludeName && ext.name === excludeName) continue;
    if (ext.replacedSkills?.length) {
      for (const s of ext.replacedSkills) result.add(s);
    }
  }
  return result;
}

/**
 * Restore base skills that were previously replaced, filtering out skills still replaced by other extensions.
 */
export async function restoreBaseSkills(
  projectDir: string,
  agents: AgentInstallation[],
  skillNames: string[],
  excludeStillReplaced: Set<string>,
): Promise<string[]> {
  const available = await getAvailableSkills();
  const toRestore = skillNames.filter(s => available.includes(s) && !excludeStillReplaced.has(s));
  if (toRestore.length > 0) {
    await installSkillsForAllAgents(projectDir, agents, toRestore);
  }
  return toRestore;
}

/**
 * Strip extension injections from all agents. Uses manifest if available, falls back to name-based scan.
 */
export async function stripInjectionsForAllAgents(
  projectDir: string,
  agents: AgentInstallation[],
  extensionName: string,
  manifest?: ExtensionManifest | null,
): Promise<void> {
  for (const agent of agents) {
    if (manifest) {
      await stripAllExtensionInjections(projectDir, agent, extensionName, manifest);
    } else {
      await stripInjectionsByExtensionName(projectDir, agent, extensionName);
    }
  }
}

/**
 * Remove custom (non-replacement) skills from all agents based on the manifest.
 * Returns the list of custom skill paths that were targeted for removal.
 */
export async function removeCustomSkillsForAllAgents(
  projectDir: string,
  agents: AgentInstallation[],
  manifest: ExtensionManifest,
): Promise<Map<string, string[]>> {
  const replacesPaths = new Set(Object.keys(manifest.replaces ?? {}));
  const customSkills = (manifest.skills ?? []).filter(s => !replacesPaths.has(s));
  if (customSkills.length === 0) return new Map();
  return removeSkillsForAllAgents(projectDir, agents, customSkills);
}
