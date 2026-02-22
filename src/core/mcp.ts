import path from 'path';
import { readJsonFile, writeJsonFile, getMcpDir, ensureDir, fileExists } from '../utils/fs.js';
import { getAgentConfig } from './agents.js';

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface OpenCodeMcpServerConfig {
  type: 'local';
  command: string[];
  environment?: Record<string, string>;
}

export interface McpOptions {
  github: boolean;
  filesystem: boolean;
  postgres: boolean;
  chromeDevtools: boolean;
}

type McpSettingsFormat = 'standard' | 'opencode';

interface McpServerDefinition {
  key: keyof McpOptions;
  templateFile: string;
  instruction: string;
}

function toOpenCodeFormat(config: McpServerConfig): OpenCodeMcpServerConfig {
  const command = [config.command, ...(config.args || [])];
  const result: OpenCodeMcpServerConfig = { type: 'local', command };
  if (config.env) {
    result.environment = config.env;
  }
  return result;
}

const MCP_SERVERS: McpServerDefinition[] = [
  {
    key: 'github',
    templateFile: 'github.json',
    instruction: 'GitHub MCP: Set GITHUB_TOKEN environment variable with your GitHub personal access token',
  },
  {
    key: 'filesystem',
    templateFile: 'filesystem.json',
    instruction: 'Filesystem MCP: No additional configuration needed. Server provides file access tools.',
  },
  {
    key: 'postgres',
    templateFile: 'postgres.json',
    instruction: 'Postgres MCP: Set DATABASE_URL environment variable with your PostgreSQL connection string',
  },
  {
    key: 'chromeDevtools',
    templateFile: 'chrome-devtools.json',
    instruction: 'Chrome Devtools MCP: No additional configuration needed. Server provides your coding agent control and inspect a live Chrome browser.',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureNestedRecord(object: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = object[key];
  if (isRecord(value)) {
    return value;
  }
  const next: Record<string, unknown> = {};
  object[key] = next;
  return next;
}

async function loadSettings(settingsPath: string): Promise<Record<string, unknown>> {
  if (!(await fileExists(settingsPath))) {
    return {};
  }

  const parsed = await readJsonFile<unknown>(settingsPath);
  return isRecord(parsed) ? parsed : {};
}

function applyServerConfig(
  settings: Record<string, unknown>,
  format: McpSettingsFormat,
  key: keyof McpOptions,
  template: McpServerConfig,
): void {
  if (format === 'opencode') {
    ensureNestedRecord(settings, 'mcp')[key] = toOpenCodeFormat(template);
    return;
  }

  ensureNestedRecord(settings, 'mcpServers')[key] = template;
}

export async function configureMcp(projectDir: string, options: McpOptions, agentId: string = 'claude'): Promise<string[]> {
  const agent = getAgentConfig(agentId);

  if (!agent.supportsMcp || !agent.settingsFile) {
    return [];
  }

  const format: McpSettingsFormat = agentId === 'opencode' ? 'opencode' : 'standard';
  const configuredServers: string[] = [];
  const settingsPath = path.join(projectDir, agent.settingsFile);
  const settingsDir = path.dirname(settingsPath);

  await ensureDir(settingsDir);

  const mcpTemplatesDir = path.join(getMcpDir(), 'templates');
  const settings = await loadSettings(settingsPath);

  for (const server of MCP_SERVERS) {
    if (!options[server.key]) {
      continue;
    }

    const template = await readJsonFile<McpServerConfig>(path.join(mcpTemplatesDir, server.templateFile));
    if (!template) {
      continue;
    }

    applyServerConfig(settings, format, server.key, template);
    configuredServers.push(server.key);
  }

  if (configuredServers.length > 0) {
    await writeJsonFile(settingsPath, settings);
  }

  return configuredServers;
}

export function getMcpInstructions(servers: string[]): string[] {
  const selected = new Set(servers);
  return MCP_SERVERS
    .filter(server => selected.has(server.key))
    .map(server => server.instruction);
}
