import "server-only";

import { db } from "./db";
import {
  requireCommentEntityForLead,
  throwMappedDatabaseError,
} from "./helpers";
import type { AuthContext } from "@/lib/auth/context";
import { assertLeadWriteAccess, canReadLead } from "@/lib/auth/guards";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  assertCommentEntity,
  assertUuid,
  normalizeLimit,
} from "@/lib/validation";
import type { Comment, CommentEntity } from "@/lib/database.types";

export type CommentWithAuthor = Comment & {
  author: { full_name: string; role: string } | null;
};

export async function listComments(
  ctx: AuthContext,
  leadIdValue: string,
  entity?: { type: CommentEntity; id: string | null },
  limit = 200
): Promise<CommentWithAuthor[]> {
  const leadId = assertUuid(leadIdValue, "Lead");
  const leadResult = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data || !canReadLead(ctx, leadResult.data)) return [];

  let query = db
    .from("comments")
    .select("*, author:profiles!comments_author_id_fkey(full_name, role)")
    .eq("lead_id", leadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(normalizeLimit(limit, 200, 200));
  if (entity) {
    const type = assertCommentEntity(entity.type);
    query = query.eq("entity_type", type);
    query = entity.id
      ? query.eq("entity_id", assertUuid(entity.id, "Comment target"))
      : query.is("entity_id", null);
  }
  const { data, error } = await query;
  if (error) throw error;
  return [...(data as CommentWithAuthor[])].reverse();
}

export async function addComment(
  ctx: AuthContext,
  input: {
    lead_id: string;
    body: string;
    entity_type?: CommentEntity;
    entity_id?: string | null;
  }
): Promise<Comment> {
  const leadId = assertUuid(input.lead_id, "Lead");
  const body = input.body.trim();
  if (!body || body.length > 4_000) {
    throw new ValidationError("Comment must be between 1 and 4,000 characters");
  }
  const entityType = assertCommentEntity(input.entity_type ?? "lead");

  const leadResult = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (leadResult.error) throw leadResult.error;
  if (!leadResult.data) throw new NotFoundError("Lead");
  assertLeadWriteAccess(ctx, leadResult.data);
  await requireCommentEntityForLead(entityType, input.entity_id, leadId);

  const { data, error } = await db.rpc("create_comment", {
    p_lead_id: leadId,
    p_entity_type: entityType,
    p_entity_id: input.entity_id ?? null,
    p_body: body,
    p_actor: ctx.userId,
  });
  if (error) throwMappedDatabaseError(error, "Comment");
  return data;
}

async function loadCommentForMutation(id: string) {
  const commentId = assertUuid(id, "Comment");
  const result = await db
    .from("comments")
    .select(
      "id, author_id, branch_id, lead_id, version, deleted_at, lead:leads(assignee_id)"
    )
    .eq("id", commentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new NotFoundError("Comment");
  return result.data;
}

function validateExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ValidationError("Comment version is invalid");
  }
  return value;
}

export async function updateComment(
  ctx: AuthContext,
  id: string,
  bodyValue: string,
  expectedVersionValue: number
): Promise<{ lead_id: string }> {
  const expectedVersion = validateExpectedVersion(expectedVersionValue);
  const body = bodyValue.trim();
  if (!body || body.length > 4_000) {
    throw new ValidationError("Comment must be between 1 and 4,000 characters");
  }
  const comment = await loadCommentForMutation(id);
  const lead = {
    branch_id: comment.branch_id,
    assignee_id: (comment.lead as { assignee_id: string | null } | null)?.assignee_id ?? null,
  };
  assertLeadWriteAccess(ctx, lead);
  if (comment.author_id !== ctx.userId) {
    throw new AuthorizationError("You can only edit your own accessible comments");
  }
  if (comment.version !== expectedVersion) {
    throw new ConflictError(
      "This comment changed since the thread was loaded. Refresh and try again."
    );
  }

  const { data, error } = await db.rpc("update_comment", {
    p_comment_id: comment.id,
    p_body: body,
    p_actor: ctx.userId,
    p_expected_version: expectedVersion,
  });
  if (error) throwMappedDatabaseError(error, "Comment");
  return { lead_id: data.lead_id };
}

export async function archiveComment(
  ctx: AuthContext,
  id: string,
  reasonValue: string,
  expectedVersionValue: number
): Promise<{ lead_id: string }> {
  const expectedVersion = validateExpectedVersion(expectedVersionValue);
  const reason = reasonValue.trim();
  if (!reason || reason.length > 500) {
    throw new ValidationError("Archive reason must be between 1 and 500 characters");
  }
  const comment = await loadCommentForMutation(id);
  const assignee =
    (comment.lead as { assignee_id: string | null } | null)?.assignee_id ?? null;
  assertLeadWriteAccess(ctx, {
    branch_id: comment.branch_id,
    assignee_id: assignee,
  });

  if (comment.author_id !== ctx.userId) {
    if (ctx.role === "front_office" || ctx.role === "doctor") {
      throw new AuthorizationError("You can only archive your own comments");
    }
  }
  if (comment.version !== expectedVersion) {
    throw new ConflictError(
      "This comment changed since the thread was loaded. Refresh and try again."
    );
  }

  const { data, error } = await db.rpc("soft_delete_comment", {
    p_comment_id: comment.id,
    p_actor: ctx.userId,
    p_reason: reason,
    p_expected_version: expectedVersion,
  });
  if (error) throwMappedDatabaseError(error, "Comment");
  return { lead_id: data.lead_id };
}
