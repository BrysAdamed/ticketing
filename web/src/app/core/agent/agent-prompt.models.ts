import { TicketType } from '@shared/domain/enums';
import { UserRef } from '../tickets/ticket.models';

export type AgentPromptMode = 'Inherit' | 'Custom' | 'Off';
export type AgentPromptSource = 'Default' | 'Custom';

/// Where prompt templates live: a project's overrides, or the instance defaults and guardrails (Admins).
export type AgentPromptScope = { kind: 'project'; projectKey: string } | { kind: 'instance' };

/// A ticket type (`Bug`, `UserStory`, …) or `Guardrails` (instance scope only).
export type AgentPromptSlot = TicketType | 'Guardrails';

/// A template or length problem from a preview; `line` and `column` (1-based) are set for template syntax errors.
export interface AgentPromptIssue {
  code: string;
  message: string;
  line: number | null;
  column: number | null;
}

/// Item of `GET /projects/{pk}/agent/prompts`. `version` is the project row's (0 while it never left Inherit).
export interface ProjectAgentPromptSummary {
  type: TicketType;
  mode: AgentPromptMode;
  version: number;
  effectiveSource: AgentPromptSource | null;
  effectiveVersion: number | null;
  defaultVersion: number;
  defaultChanged: boolean;
  updatedBy: UserRef | null;
  updatedAt: string | null;
}

/// `GET /projects/{pk}/agent/prompts/{type}`.
export interface ProjectAgentPrompt {
  type: TicketType;
  mode: AgentPromptMode;
  version: number;
  body: string | null;
  effectiveSource: AgentPromptSource | null;
  effectiveVersion: number | null;
  effectiveBody: string | null;
  defaultVersion: number;
  defaultBody: string;
  basedOnDefaultVersion: number | null;
  defaultChanged: boolean;
  guardrailsVersion: number;
  guardrails: string | null;
  updatedBy: UserRef | null;
  updatedAt: string | null;
}

/// Item of `GET /admin/agent/prompts`.
export interface InstanceAgentPromptSummary {
  slot: AgentPromptSlot;
  type: TicketType | null;
  version: number;
  builtInVersion: string | null;
  followsBuiltIn: boolean;
  latestBuiltInVersion: string;
  newerBuiltInAvailable: boolean;
  overridingProjects: number;
  updatedBy: UserRef | null;
  updatedAt: string;
}

/// `GET /admin/agent/prompts/{slot}`.
export interface InstanceAgentPrompt extends InstanceAgentPromptSummary {
  body: string | null;
  builtInBody: string;
}

export interface AgentPromptVersionSummary {
  number: number;
  mode: AgentPromptMode;
  builtInVersion: string | null;
  changeNote: string | null;
  author: UserRef | null;
  createdAt: string;
  restoredFrom: number | null;
}

export interface AgentPromptVersion extends AgentPromptVersionSummary {
  body: string | null;
}

/// `POST …/preview`. `prompt` is null when the template has errors; `guardrailsStart` is where the
/// guardrails begin in `prompt` (null without guardrails).
export interface AgentPromptPreview {
  prompt: string | null;
  length: number;
  lengthLimit: number;
  ticketKey: string;
  errors: AgentPromptIssue[];
  guardrailsStart: number | null;
}

export interface AgentPromptPlaceholder {
  name: string;
  description: string;
}

/// Body of `PUT …/prompts/{slot}`. Instance slots ignore `mode` (always Custom).
export interface SaveAgentPrompt {
  mode: AgentPromptMode;
  body: string | null;
  changeNote: string | null;
  baseVersion: number;
}

/// Body of reset and restore requests.
export interface AgentPromptVersionChange {
  changeNote: string | null;
  baseVersion: number;
}

/// Feature flag gating everything about agent delegation.
export const AGENT_FLAG = 'agent.delegate';

/// Template body limit, the same as the whole prompt's (`AgentPrompt.LengthLimit`).
export const AGENT_PROMPT_LENGTH_LIMIT = 4500;
export const AGENT_PROMPT_CHANGE_NOTE_MAX = 200;
export const AGENT_PROMPT_VERSION_CONFLICT = 'agent.prompt.versionConflict';
