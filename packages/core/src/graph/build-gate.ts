import type { SourceAtom, SourceEdge } from "../model/source";
import { validatePackGraph, type ValidationIssue } from "./validate";
import { validateClaudeExportCompliance, type ClaudeComplianceIssue } from "./compliance";
import { lintLifecycle, type LifecycleIssue } from "./lifecycle";
import { compile } from "../ir/compile";
import { claudeCodeAdapter } from "../adapters/claude-code";
import { lintOrgPolicy, type OrgPolicy } from "../policy/org-policy";

/** A non-blocking adapter lint finding, e.g. an unknown tool name. */
export type LintIssue = {
  code: string;
  message: string;
  atomId?: string;
  path?: string;
};

/** An organization policy violation; an error when the policy blocks, else a warning. */
export type PolicyIssue = {
  code: string;
  message: string;
  atomId?: string;
};

export type BuildGateIssue = ValidationIssue | ClaudeComplianceIssue | LifecycleIssue | LintIssue | PolicyIssue;

export type BuildGateOptions = {
  /** The organization's policy; its violations join the gate. */
  policy?: OrgPolicy | null;
};

export type BuildGateResult = {
  valid: boolean;
  errors: BuildGateIssue[];
  warnings: BuildGateIssue[];
};

/**
 * Graph validation, Claude export compliance, lifecycle checks and the
 * organization's policy: the same gate the canvas shows.
 */
export function evaluateBuildGate(atoms: SourceAtom[], edges: SourceEdge[], options: BuildGateOptions = {}): BuildGateResult {
  const graph = validatePackGraph(atoms, edges);
  const compliance = validateClaudeExportCompliance(atoms, edges);
  const lifecycle = lintLifecycle(atoms, edges);
  const { ir } = compile({ atoms, edges });
  const policy: PolicyIssue[] = [];
  const policyWarnings: PolicyIssue[] = [];
  if (options.policy) {
    for (const { code, message, atomId, severity } of lintOrgPolicy(ir, options.policy)) {
      (severity === "error" ? policy : policyWarnings).push({ code, message, ...(atomId ? { atomId } : {}) });
    }
  }
  const errors: BuildGateIssue[] = [...graph.errors, ...compliance.errors, ...lifecycle.errors, ...policy];
  // Adapter lint findings are warnings: they never block export.
  const lint: LintIssue[] = claudeCodeAdapter
    .lint(ir)
    .map(({ code, message, atomId, path }) => ({ code, message, ...(atomId ? { atomId } : {}), ...(path ? { path } : {}) }));
  const warnings: BuildGateIssue[] = [...graph.warnings, ...compliance.warnings, ...lifecycle.warnings, ...lint, ...policyWarnings];
  return { valid: errors.length === 0, errors, warnings };
}
