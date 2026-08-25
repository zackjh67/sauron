// Only models that take the exact same request shape (thinking: adaptive +
// output_config.effort) belong here — e.g. Haiku 4.5 doesn't support
// `effort` at all, so offering it would mean branching the request shape
// per model. Keep this list to models where that's not a concern.
export const SELECTABLE_MODELS = ["claude-sonnet-5", "claude-opus-5"] as const;
export type SelectableModel = (typeof SELECTABLE_MODELS)[number];
export const DEFAULT_MODEL: SelectableModel = "claude-sonnet-5";

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export const DEFAULT_EFFORT: EffortLevel = "medium";

export function parseModel(value: unknown): SelectableModel {
  return (SELECTABLE_MODELS as readonly string[]).includes(value as string)
    ? (value as SelectableModel)
    : DEFAULT_MODEL;
}

export function parseEffort(value: unknown): EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value as string) ? (value as EffortLevel) : DEFAULT_EFFORT;
}
