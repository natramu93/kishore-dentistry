"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { addCommentAction, deleteCommentAction } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Trash2 } from "lucide-react";
import type { CommentWithAuthor } from "@/data/comments";
import type { CommentEntity } from "@/lib/database.types";
import { fmt } from "@/lib/tz";

// Reusable comment thread, mounted at the bottom of the lead page and of
// every stage card (appointment, treatment, follow-up, invoice).
export function CommentThread({
  leadId,
  entityType = "lead",
  entityId = null,
  comments,
  currentUserId,
  canModerate,
  compact = false,
}: {
  leadId: string;
  entityType?: CommentEntity;
  entityId?: string | null;
  comments: CommentWithAuthor[];
  currentUserId: string;
  canModerate: boolean;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(!compact);
  const formRef = useRef<HTMLFormElement>(null);

  const scoped = comments.filter(
    (c) => c.entity_type === entityType && (c.entity_id ?? null) === entityId
  );

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await addCommentAction(formData);
      if (result.ok) {
        formRef.current?.reset();
      } else {
        toast.error(result.error);
      }
    });
  }

  function remove(commentId: string) {
    startTransition(async () => {
      const result = await deleteCommentAction(commentId, leadId);
      if (!result.ok) toast.error(result.error);
    });
  }

  if (compact && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-2"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {scoped.length ? `${scoped.length} comment${scoped.length > 1 ? "s" : ""}` : "Add comment"}
      </button>
    );
  }

  return (
    <div className={compact ? "mt-3 border-t pt-3 space-y-3" : "space-y-3"}>
      {scoped.length > 0 && (
        <ul className="space-y-2">
          {scoped.map((c) => (
            <li key={c.id} className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-xs">
                  {c.author?.full_name ?? "Unknown"}
                  <span className="text-muted-foreground font-normal ml-2">
                    {fmt(c.created_at)}
                  </span>
                </span>
                {(c.author_id === currentUserId || canModerate) && (
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    disabled={pending}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Delete comment"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form ref={formRef} action={submit} className="flex flex-col gap-2">
        <input type="hidden" name="lead_id" value={leadId} />
        <input type="hidden" name="entity_type" value={entityType} />
        {entityId && <input type="hidden" name="entity_id" value={entityId} />}
        <Textarea
          name="body"
          placeholder="Write a comment…"
          rows={compact ? 2 : 3}
          required
          className="text-sm"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Posting…" : "Comment"}
          </Button>
        </div>
      </form>
    </div>
  );
}
