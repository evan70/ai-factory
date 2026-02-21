import type { AgentTransformer, TransformResult } from '../transformer.js';

function toCodexInvocation(content: string): string {
  return content.replace(/(^|[^A-Za-z0-9_-])\/(aif(?:-[a-z0-9-]+)?)/g, '$1$$2');
}

export class CodexTransformer implements AgentTransformer {
  transform(skillName: string, content: string): TransformResult {
    return {
      targetDir: skillName,
      targetName: 'SKILL.md',
      content: toCodexInvocation(content),
      flat: false,
    };
  }

  getWelcomeMessage(): string[] {
    return [
      '1. Open Codex CLI in this directory',
      '2. Run $aif to analyze project and generate stack-specific skills',
    ];
  }
}

