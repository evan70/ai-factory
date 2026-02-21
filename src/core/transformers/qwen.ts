import type { AgentTransformer, TransformResult } from '../transformer.js';

function toQwenInvocation(content: string): string {
  return content.replace(/(^|[^A-Za-z0-9_-])\/(aif(?:-[a-z0-9-]+)?)/g, '$1/skills $2');
}

export class QwenTransformer implements AgentTransformer {
  transform(skillName: string, content: string): TransformResult {
    return {
      targetDir: skillName,
      targetName: 'SKILL.md',
      content: toQwenInvocation(content),
      flat: false,
    };
  }

  getWelcomeMessage(): string[] {
    return [
      '1. Open Qwen Code in this directory',
      '2. MCP servers configured in .qwen/settings.json (if selected)',
      '3. Run /skills aif to analyze project and generate stack-specific skills',
    ];
  }
}

