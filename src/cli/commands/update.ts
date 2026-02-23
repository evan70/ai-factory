import chalk from 'chalk';
import {getCurrentVersion, loadConfig, saveConfig} from '../../core/config.js';
import {getAvailableSkills, partitionSkills, updateSkills} from '../../core/installer.js';
import {applyExtensionInjections} from '../../core/injections.js';

export async function updateCommand(): Promise<void> {
  const projectDir = process.cwd();

  console.log(chalk.bold.blue('\n🏭 AI Factory - Update Skills\n'));

  const config = await loadConfig(projectDir);

  if (!config) {
    console.log(chalk.red('Error: No .ai-factory.json found.'));
    console.log(chalk.dim('Run "ai-factory init" to set up your project first.'));
    process.exit(1);
  }

  const currentVersion = getCurrentVersion();

  console.log(chalk.dim(`Config version: ${config.version}`));
  console.log(chalk.dim(`Package version: ${currentVersion}\n`));

  console.log(chalk.dim('Updating skills...\n'));

  try {
    const availableSkills = await getAvailableSkills();
    const previousBaseSkillsByAgent = new Map<string, string[]>();

    for (const agent of config.agents) {
      const { base: previousBaseSkills } = partitionSkills(agent.installedSkills);
      previousBaseSkillsByAgent.set(agent.id, previousBaseSkills);
      const newSkills = availableSkills.filter(s => !previousBaseSkills.includes(s));

      const removedSkills = previousBaseSkills.filter(s => !availableSkills.includes(s));

      if (newSkills.length > 0) {
        console.log(chalk.cyan(`📦 [${agent.id}] New skills available: ${newSkills.join(', ')}`));
      }
      if (removedSkills.length > 0) {
        console.log(chalk.yellow(`🗑️  [${agent.id}] Removed skills: ${removedSkills.join(', ')}`));
      }
    }
    if (config.agents.length > 0) {
      console.log('');
    }

    for (const agent of config.agents) {
      agent.installedSkills = await updateSkills(agent, projectDir);
    }

    // Re-apply extension injections
    if (config.extensions?.length) {
      let totalInjections = 0;
      for (const agent of config.agents) {
        totalInjections += await applyExtensionInjections(projectDir, agent, config.extensions!);
      }
      if (totalInjections > 0) {
        console.log(chalk.green(`✓ Re-applied ${totalInjections} extension injection(s)`));
      }
    }

    config.version = currentVersion;
    await saveConfig(projectDir, config);

    console.log(chalk.green('✓ Skills updated successfully'));
    console.log(chalk.green('✓ Configuration updated'));

    for (const agent of config.agents) {
      const previousBaseSkills = previousBaseSkillsByAgent.get(agent.id) ?? [];
      const newSkills = availableSkills.filter(s => !previousBaseSkills.includes(s));
      const { base: baseSkills, custom: customSkills } = partitionSkills(agent.installedSkills);

      console.log(chalk.bold(`\n[${agent.id}] Base skills:`));
      for (const skill of baseSkills) {
        const isNew = newSkills.includes(skill);
        console.log(chalk.dim(`  - ${skill}`) + (isNew ? chalk.green(' (new)') : ''));
      }

      if (customSkills.length > 0) {
        console.log(chalk.bold(`[${agent.id}] Custom skills (preserved):`));
        for (const skill of customSkills) {
          console.log(chalk.dim(`  - ${skill}`));
        }
      }
    }
    console.log('');

  } catch (error) {
    console.log(chalk.red(`Error updating skills: ${(error as Error).message}`));
    process.exit(1);
  }
}
