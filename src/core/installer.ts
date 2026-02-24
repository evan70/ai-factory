import path from 'path';
import { copyDirectory, getSkillsDir, ensureDir, listDirectories, readTextFile, writeTextFile, removeDirectory, fileExists } from '../utils/fs.js';
import type { AgentInstallation } from './config.js';
import { getAgentConfig } from './agents.js';
import { processSkillTemplates, buildTemplateVars, processTemplate } from './template.js';
import { getTransformer, extractFrontmatterName, replaceFrontmatterName } from './transformer.js';

export interface InstallOptions {
  projectDir: string;
  skillsDir: string;
  skills: string[];
  agentId: string;
}

async function installSkillWithTransformer(
  sourceSkillDir: string,
  skillName: string,
  projectDir: string,
  skillsDir: string,
  agentId: string,
  agentConfig: ReturnType<typeof getAgentConfig>,
): Promise<void> {
  const transformer = getTransformer(agentId);
  const skillMdPath = path.join(sourceSkillDir, 'SKILL.md');
  const content = await readTextFile(skillMdPath);
  if (!content) {
    throw new Error(`SKILL.md not found in ${sourceSkillDir}`);
  }

  // If skill is installed under a different name (e.g. replacement), rewrite frontmatter name
  const fmName = extractFrontmatterName(content);
  const adjustedContent = (fmName && fmName !== skillName) ? replaceFrontmatterName(content, skillName) : content;

  const result = transformer.transform(skillName, adjustedContent);
  const vars = buildTemplateVars(agentConfig);

  if (result.flat) {
    const targetPath = path.join(projectDir, agentConfig.configDir, result.targetDir, result.targetName);
    await writeTextFile(targetPath, processTemplate(result.content, vars));

    // Copy references directory if it exists in the source skill
    const sourceRefsDir = path.join(sourceSkillDir, 'references');
    if (await fileExists(sourceRefsDir)) {
      const targetRefsDir = path.join(projectDir, agentConfig.configDir, result.targetDir, 'references');
      await copyDirectory(sourceRefsDir, targetRefsDir);
    }
  } else {
    const targetSkillDir = path.join(projectDir, skillsDir, result.targetDir);
    await copyDirectory(sourceSkillDir, targetSkillDir);
    if (result.content !== content) {
      await writeTextFile(path.join(targetSkillDir, 'SKILL.md'), result.content);
    } else if (adjustedContent !== content) {
      await writeTextFile(path.join(targetSkillDir, 'SKILL.md'), adjustedContent);
    }
    await processSkillTemplates(targetSkillDir, agentConfig);
  }
}

export async function installSkills(options: InstallOptions): Promise<string[]> {
  const { projectDir, skillsDir, skills, agentId } = options;
  const installedSkills: string[] = [];
  const agentConfig = getAgentConfig(agentId);

  const targetDir = path.join(projectDir, skillsDir);
  await ensureDir(targetDir);

  const packageSkillsDir = getSkillsDir();

  for (const skill of skills) {
    const sourceSkillDir = path.join(packageSkillsDir, skill);

    try {
      await installSkillWithTransformer(sourceSkillDir, skill, projectDir, skillsDir, agentId, agentConfig);
      installedSkills.push(skill);
    } catch (error) {
      console.warn(`Warning: Could not install skill "${skill}": ${error}`);
    }
  }

  const transformer = getTransformer(agentId);
  if (transformer.postInstall) {
    await transformer.postInstall(projectDir);
  }

  return installedSkills;
}

export function partitionSkills(skills: string[]): { base: string[], custom: string[] } {
  return {
    base: skills.filter(s => !s.includes('/')),
    custom: skills.filter(s => s.includes('/')),
  };
}

export async function getAvailableSkills(): Promise<string[]> {
  const packageSkillsDir = getSkillsDir();
  const dirs = await listDirectories(packageSkillsDir);
  return dirs.filter(dir => !dir.startsWith('_'));
}

export async function installExtensionSkills(
  projectDir: string,
  agentInstallation: AgentInstallation,
  extensionDir: string,
  skillPaths: string[],
  nameOverrides?: Record<string, string>,
): Promise<string[]> {
  const agentConfig = getAgentConfig(agentInstallation.id);
  const installed: string[] = [];

  for (const skillPath of skillPaths) {
    const sourceDir = path.join(extensionDir, skillPath);
    const skillName = nameOverrides?.[skillPath] ?? path.basename(skillPath);
    try {
      await installSkillWithTransformer(sourceDir, skillName, projectDir, agentInstallation.skillsDir, agentInstallation.id, agentConfig);
      installed.push(skillName);
    } catch (error) {
      console.warn(`Warning: Could not install extension skill "${skillName}": ${error}`);
    }
  }

  return installed;
}

async function removeSkillsByName(
  projectDir: string,
  agentInstallation: AgentInstallation,
  skillNames: string[],
): Promise<string[]> {
  const agentConfig = getAgentConfig(agentInstallation.id);
  const transformer = getTransformer(agentInstallation.id);
  const removed: string[] = [];

  for (const skillName of skillNames) {
    try {
      const result = transformer.transform(skillName, '');
      if (result.flat) {
        const targetPath = path.join(projectDir, agentConfig.configDir, result.targetDir, result.targetName);
        await removeDirectory(targetPath);
      } else {
        const targetSkillDir = path.join(projectDir, agentInstallation.skillsDir, result.targetDir);
        await removeDirectory(targetSkillDir);
      }
      removed.push(skillName);
    } catch {
      // Skill may not exist, ignore
    }
  }

  return removed;
}

export async function removeExtensionSkills(
  projectDir: string,
  agentInstallation: AgentInstallation,
  skillPaths: string[],
): Promise<string[]> {
  return removeSkillsByName(projectDir, agentInstallation, skillPaths.map(p => path.basename(p)));
}

export async function updateSkills(agentInstallation: AgentInstallation, projectDir: string, excludeSkills?: string[]): Promise<string[]> {
  const availableSkills = await getAvailableSkills();
  const excludeSet = new Set(excludeSkills ?? []);
  const skillsToInstall = availableSkills.filter(s => !excludeSet.has(s));

  const { base: previousBaseSkills, custom } = partitionSkills(agentInstallation.installedSkills);
  const availableSet = new Set(availableSkills);

  const removedSkills = previousBaseSkills.filter(s => !availableSet.has(s) && !excludeSet.has(s));
  if (removedSkills.length > 0) {
    await removeSkillsByName(projectDir, agentInstallation, removedSkills);
  }

  const installedBaseSkills = await installSkills({
    projectDir,
    skillsDir: agentInstallation.skillsDir,
    skills: skillsToInstall,
    agentId: agentInstallation.id,
  });

  return [...installedBaseSkills, ...custom];
}
