import "server-only";

import { db } from "./db";
import type { AuthContext } from "@/lib/auth/context";
import { AuthorizationError } from "@/lib/auth/context";
import { assertBranchAccess, canReadLead } from "@/lib/auth/guards";
import type { Comment, CommentEntity } from "@/lib/database.types";

export type CommentWithAuthor = Comment & {
  author: { full_name: string; role: string } | null;
};

export async function listComments(
  ctx: AuthContext,
  leadId: string,
  entity?: { type: CommentEntity; id: string | null }
): Promise<CommentWithAuthor[]> {
  const { data: lead } = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead || !canReadLead(ctx, lead)) return [];

  let q = db
    .from("comments")
    .select("*, author:profiles!comments_author_id_fkey(full_name, role)")
    .eq("lead_id", leadId)
    .order("created_at");
  if (entity) {
    q = q.eq("entity_type", entity.type);
    q = entity.id ? q.eq("entity_id", entity.id) : q.is("entity_id", null);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CommentWithAuthor[];
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
  const { data: lead } = await db
    .from("leads")
    .select("branch_id, assignee_id")
    .eq("id", input.lead_id)
    .maybeSingle();
  if (!lead || !canReadLead(ctx, lead)) {
    throw new AuthorizationError("No access to this lead");
  }

  const { data, error } = await db
    .from("comments")
    .insert({
      lead_id: input.lead_id,
      body: input.body,
      entity_type: input.entity_type ?? "lead",
      entity_id: input.entity_id ?? null,
      author_id: ctx.userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateComment(ctx: AuthContext, id: string, body: string) {
  const { data: comment } = await db.from("comments").select("author_id").eq("id", id).maybeSingle();
  if (!comment) throw new Error("Comment not found");
  if (comment.author_id !== ctx.userId) {
    throw new AuthorizationError("You can only edit your own comments");
  }
  const { error } = await db.from("comments").update({ body }).eq("id", id);
  if (error) throw error;
}

export async function deleteComment(ctx: AuthContext, id: string) {
  const { data: comment } = await db
    .from("comments")
    .select("author_id, branch_id")
    .eq("id", id)
    .maybeSingle();
  if (!comment) return;

  const isOwn = comment.author_id === ctx.userId;
  if (!isOwn) {
    // Operations/Clinical Head/admin may moderate within their branch scope
    if (ctx.role === "front_office" || ctx.role === "doctor") {
      throw new AuthorizationError("You can only delete your own comments");
    }
    assertBranchAccess(ctx, comment.branch_id);
  }
  const { error } = await db.from("comments").delete().eq("id", id);
  if (error) throw error;
}
