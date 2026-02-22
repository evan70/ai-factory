import path from 'path';
import { readJsonFile, readTextFile, fileExists } from '../../utils/fs.js';

export interface DetectedStack {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  frameworks: string[];
  languages: string[];
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface ComposerJson {
  require?: Record<string, string>;
  'require-dev'?: Record<string, string>;
}

export async function detectStack(projectDir: string): Promise<DetectedStack | null> {
  const packageJsonPath = path.join(projectDir, 'package.json');
  const composerJsonPath = path.join(projectDir, 'composer.json');
  const requirementsPath = path.join(projectDir, 'requirements.txt');
  const pyprojectPath = path.join(projectDir, 'pyproject.toml');
  const goModPath = path.join(projectDir, 'go.mod');
  const cargoTomlPath = path.join(projectDir, 'Cargo.toml');

  if (await fileExists(packageJsonPath)) {
    const packageJson = await readJsonFile<PackageJson>(packageJsonPath);
    if (packageJson) {
      return detectJavaScriptStack(packageJson, projectDir);
    }
  }

  if (await fileExists(composerJsonPath)) {
    const composerJson = await readJsonFile<ComposerJson>(composerJsonPath);
    if (composerJson) {
      return detectPhpStack(composerJson);
    }
  }

  if (await fileExists(requirementsPath) || await fileExists(pyprojectPath)) {
    return detectPythonStack(projectDir);
  }

  if (await fileExists(goModPath)) {
    return {
      name: 'go',
      confidence: 'high',
      frameworks: [],
      languages: ['go'],
    };
  }

  if (await fileExists(cargoTomlPath)) {
    return {
      name: 'rust',
      confidence: 'high',
      frameworks: [],
      languages: ['rust'],
    };
  }

  return null;
}

async function detectJavaScriptStack(packageJson: PackageJson, _projectDir: string): Promise<DetectedStack> {
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  const frameworks: string[] = [];
  const languages: string[] = ['javascript'];

  if (allDeps['typescript']) {
    languages.push('typescript');
  }

  if (allDeps['next']) {
    frameworks.push('next.js');

    return {
      name: 'nextjs',
      confidence: 'high',
      frameworks,
      languages,
    };
  }

  if (allDeps['react']) {
    frameworks.push('react');

    if (allDeps['vite']) {
      frameworks.push('vite');
    }

    return {
      name: 'react',
      confidence: 'high',
      frameworks,
      languages,
    };
  }

  if (allDeps['vue']) {
    frameworks.push('vue');
    return {
      name: 'vue',
      confidence: 'high',
      frameworks,
      languages,
    };
  }

  if (allDeps['express'] || allDeps['fastify'] || allDeps['koa'] || allDeps['hono']) {
    if (allDeps['express']) frameworks.push('express');
    if (allDeps['fastify']) frameworks.push('fastify');
    if (allDeps['koa']) frameworks.push('koa');
    if (allDeps['hono']) frameworks.push('hono');

    return {
      name: 'node-api',
      confidence: 'high',
      frameworks,
      languages,
    };
  }

  return {
    name: 'node',
    confidence: 'medium',
    frameworks,
    languages,
  };
}

function detectPhpStack(composerJson: ComposerJson): DetectedStack {
  const allDeps = {
    ...composerJson.require,
    ...composerJson['require-dev'],
  };

  const frameworks: string[] = [];
  const languages: string[] = ['php'];

  if (allDeps['laravel/framework']) {
    frameworks.push('laravel');
    return {
      name: 'laravel',
      confidence: 'high',
      frameworks,
      languages,
    };
  }

  if (allDeps['symfony/framework-bundle'] || allDeps['symfony/symfony']) {
    frameworks.push('symfony');
    return {
      name: 'symfony',
      confidence: 'high',
      frameworks,
      languages,
    };
  }

  if (allDeps['slim/slim']) {
    frameworks.push('slim');
    return {
      name: 'slim',
      confidence: 'high',
      frameworks,
      languages,
    };
  }

  return {
    name: 'php',
    confidence: 'medium',
    frameworks,
    languages,
  };
}

async function detectPythonStack(projectDir: string): Promise<DetectedStack> {
  const frameworks: string[] = [];
  const languages: string[] = ['python'];

  const requirementsPath = path.join(projectDir, 'requirements.txt');
  const requirements = await readTextFile(requirementsPath);

  if (requirements) {
    const lowerReqs = requirements.toLowerCase();

    if (lowerReqs.includes('django')) {
      frameworks.push('django');
      return {
        name: 'django',
        confidence: 'high',
        frameworks,
        languages,
      };
    }

    if (lowerReqs.includes('fastapi')) {
      frameworks.push('fastapi');
      return {
        name: 'fastapi',
        confidence: 'high',
        frameworks,
        languages,
      };
    }

    if (lowerReqs.includes('flask')) {
      frameworks.push('flask');
      return {
        name: 'flask',
        confidence: 'high',
        frameworks,
        languages,
      };
    }
  }

  return {
    name: 'python',
    confidence: 'medium',
    frameworks,
    languages,
  };
}
