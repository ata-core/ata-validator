/** A plan written by tablePlan in ata-validator/ir. */
export interface Plan { v: 1; ata?: string; rich: boolean; P: unknown[]; F: unknown[]; rel: boolean; sk: unknown; uses: string[] }
export interface PlanValidator {
  validate(data: unknown): { valid: true; data: unknown; errors: readonly [] } | { valid: false; errors: Array<Record<string, unknown>> }
  isValid(data: unknown): boolean
}
export declare const PLAN_VERSION: 1
/** The validator for a plan, once the kernels it names are loaded. */
export declare function fromPlan(plan: Plan): Promise<PlanValidator>
