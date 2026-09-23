import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  deriveRodrigoState,
  getRodrigoStatePresentation,
  isWorkingTaskStatus,
  type RodrigoTaskSnapshot,
} from "@/lib/agent/rodrigo-state";
import type { EmailAttachmentPreview, EmailDraftSnapshot, EmailPreview } from "@/lib/email/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AgentTaskStatusRow = {
  status: string;
  updated_at: string | null;
  completed_at: string | null;
};

type AgentApprovalPendingRow = {
  id: string;
  tool_name: string;
  created_at: string;
  payload_json: unknown;
};

export type RodrigoPendingApproval = {
  id: string;
  toolName: string;
  createdAt: string;
  emailPreview?: EmailPreview;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isEmailAttachment(value: unknown): value is EmailAttachmentPreview {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" && UUID_RE.test(value.id) &&
    typeof value.documentId === "string" && UUID_RE.test(value.documentId) &&
    typeof value.fileName === "string" && value.fileName.length <= 300 &&
    typeof value.mimeType === "string" && value.mimeType.length <= 200 &&
    typeof value.sizeBytes === "number" && Number.isSafeInteger(value.sizeBytes) && value.sizeBytes >= 0 &&
    typeof value.storageBucket === "string" && value.storageBucket.length <= 100 &&
    typeof value.storagePath === "string" && value.storagePath.length <= 1_000 &&
    (value.contentSha256 === null || (typeof value.contentSha256 === "string" && SHA256_RE.test(value.contentSha256)))
  );
}

function isEmailDraftSnapshot(value: unknown, expectedDraftId: string): value is EmailDraftSnapshot {
  if (!isRecord(value)) return false;
  const isStringArray = (candidate: unknown, maxItems: number) =>
    Array.isArray(candidate) && candidate.length <= maxItems && candidate.every((entry) => typeof entry === "string");
  return (
    value.draftId === expectedDraftId &&
    typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    isStringArray(value.to, 20) && (value.to as string[]).length > 0 &&
    isStringArray(value.cc, 20) &&
    isStringArray(value.bcc, 20) &&
    typeof value.subject === "string" && value.subject.length <= 300 &&
    typeof value.bodyText === "string" && value.bodyText.length <= 100_000 &&
    (value.bodyHtml === undefined || value.bodyHtml === null || (typeof value.bodyHtml === "string" && value.bodyHtml.length <= 200_000)) &&
    Array.isArray(value.attachments) && value.attachments.length <= 10 && value.attachments.every(isEmailAttachment) &&
    typeof value.contentHash === "string" && SHA256_RE.test(value.contentHash)
  );
}

function getEmailDraftId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const record = payload as { draft_id?: unknown; draft_snapshot?: unknown };
  if (typeof record.draft_id !== "string" || !UUID_RE.test(record.draft_id)) return null;
  if (!isRecord(record.draft_snapshot) || record.draft_snapshot.draftId !== record.draft_id) return null;
  return record.draft_id;
}

function toEmailPreview(payload: unknown, draftId: string): EmailPreview | null {
  if (!isRecord(payload) || !isEmailDraftSnapshot(payload.draft_snapshot, draftId)) return null;
  const snapshot = payload.draft_snapshot;
  return {
    draftId: snapshot.draftId,
    revision: snapshot.revision,
    to: [...snapshot.to],
    cc: [...snapshot.cc],
    bcc: [...snapshot.bcc],
    subject: snapshot.subject,
    bodyText: snapshot.bodyText,
    ...(snapshot.bodyHtml === undefined ? {} : { bodyHtml: snapshot.bodyHtml }),
    attachments: snapshot.attachments.map((attachment) => ({ ...attachment })),
    contentHash: snapshot.contentHash,
    status: "WAITING_APPROVAL",
    warnings: [],
  };
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function disabledBody() {
  const presentation = getRodrigoStatePresentation("disabled");
  return noStoreJson({
    state: "disabled",
    activeTaskCount: 0,
    pendingApprovals: [],
    updatedAt: null,
    label: presentation.label,
    description: presentation.description,
  });
}

/**
 * Read-only status projection for the global Rodrigo widget.
 *
 * It intentionally uses the session-bound client (never service_role) and
 * scopes by the authenticated tenant in addition to RLS. Minimizing the
 * panel never cancels tasks: this endpoint only reads durable state.
 */
export async function GET() {
  let empresaId: string;
  try {
    const profile = await requireProfile();
    if (!profile?.empresa_id) return noStoreJson({ error: "Unauthorized" }, 401);
    empresaId = profile.empresa_id;
  } catch {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }

  const db = await createClient();
  const { data, error } = await db
    .from("agent_tasks")
    .select("status, updated_at, completed_at")
    .eq("empresa_id", empresaId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    // A deployment that has not received the Agent Life migration must render
    // a disabled mascot rather than fail the entire authenticated shell.
    return disabledBody();
  }

  const approvalsQuery = await db
    .from("agent_approvals")
    .select("id, tool_name, created_at, payload_json")
    .eq("empresa_id", empresaId)
    .eq("status", "REQUESTED")
    .order("created_at", { ascending: true })
    .limit(10);

  const tasks: RodrigoTaskSnapshot[] = ((data ?? []) as AgentTaskStatusRow[]).map((task) => ({
    status: task.status,
    updatedAt: task.updated_at,
    completedAt: task.completed_at,
  }));
  const state = deriveRodrigoState(tasks);
  const presentation = getRodrigoStatePresentation(state);
  const approvalRows = approvalsQuery.error ? [] : (approvalsQuery.data ?? []) as AgentApprovalPendingRow[];
  const emailDraftIds = [...new Set(
    approvalRows
      .filter((row) => row.tool_name === "send_email")
      .map((row) => getEmailDraftId(row.payload_json))
      .filter((id): id is string => id !== null)
  )];

  // Defense in depth: ask the session-bound client whether the caller can
  // already read each underlying draft. This reuses email_drafts RLS (owner or
  // same-tenant admin) and fails closed if that check errors or returns nothing.
  const readableDraftIds = new Set<string>();
  if (emailDraftIds.length > 0) {
    const readableDraftsQuery = await db
      .from("email_drafts")
      .select("id")
      .eq("empresa_id", empresaId)
      .in("id", emailDraftIds);
    if (!readableDraftsQuery.error) {
      for (const row of readableDraftsQuery.data ?? []) {
        if (typeof row.id === "string") readableDraftIds.add(row.id);
      }
    }
  }

  const pendingApprovals: RodrigoPendingApproval[] = [];
  for (const row of approvalRows) {
    const item: RodrigoPendingApproval = {
      id: row.id,
      toolName: row.tool_name,
      createdAt: row.created_at,
    };
    if (row.tool_name !== "send_email") {
      pendingApprovals.push(item);
      continue;
    }

    const draftId = getEmailDraftId(row.payload_json);
    if (!draftId || !readableDraftIds.has(draftId)) continue;
    const preview = toEmailPreview(row.payload_json, draftId);
    if (!preview) continue;

    item.emailPreview = preview;
    pendingApprovals.push(item);
  }

  return noStoreJson({
    state,
    activeTaskCount: tasks.filter((task) => isWorkingTaskStatus(task.status)).length,
    pendingApprovals,
    updatedAt: tasks[0]?.updatedAt ?? null,
    label: presentation.label,
    description: presentation.description,
  });
}
