/**
 * agent-tools-signature.test.ts — Phase 8 Architecture Constraint Verification
 *
 * Ràng buộc cứng: KHÔNG CÓ tool nào của agent được nhận tham số `confidence`.
 * Tool chỉ báo những gì nó quan sát được (factual observation).
 * Nếu một dữ kiện chưa chắc chắn, agent phải gọi `suggest_fact`, không dùng confidence.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Phase 8 Agent Tool & Skill Signatures', () => {
  const skillsDir = path.resolve(__dirname, '../../src/modules/agent/skills');
  const toolsDir = path.resolve(__dirname, '../../src/modules/agent/tools');

  it('ensures all skill files strictly forbid confidence parameter in tools', () => {
    expect(fs.existsSync(skillsDir)).toBe(true);
    const skillFiles = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
    expect(skillFiles.length).toBeGreaterThanOrEqual(5);

    for (const file of skillFiles) {
      const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');

      // Skills must not instruct agent to pass confidence parameter
      expect(content).not.toMatch(/record_fact\([^)]*confidence/i);
      expect(content).not.toMatch(/suggest_fact\([^)]*confidence/i);
      expect(content).not.toMatch(/propose_message\([^)]*confidence/i);
      expect(content).not.toMatch(/enrich_from_zalo\([^)]*confidence/i);
    }
  });

  it('ensures bang-chung.md explicitly states no confidence parameter', () => {
    const bangChungPath = path.join(skillsDir, 'bang-chung.md');
    expect(fs.existsSync(bangChungPath)).toBe(true);
    const content = fs.readFileSync(bangChungPath, 'utf-8');

    expect(content).toContain('Bạn không có tham số `confidence` và sẽ không bao giờ có');
  });

  it('scans agent tool definitions (if present) ensuring no tool parameter accepts confidence', () => {
    if (fs.existsSync(toolsDir)) {
      const toolFiles = fs.readdirSync(toolsDir).filter(f => f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.json'));
      for (const file of toolFiles) {
        const content = fs.readFileSync(path.join(toolsDir, file), 'utf-8');
        // Tool schema properties and function arguments must not have 'confidence'
        expect(content).not.toMatch(/confidence:\s*\{/i);
        expect(content).not.toMatch(/confidence:\s*z\./i);
        expect(content).not.toMatch(/confidence\??:\s*(number|float|string)/i);
      }
    }
  });
});
