"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addCommentAction,
  archiveCommentAction,
  updateCommentAction,
} from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Archive, MessageSquare, Pencil } from "lucide-react";
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
  canWrite = true,
  compact = false,
}: {
  leadId: string;
  entityType?: CommentEntity;
  entityId?: string | null;
  comments: CommentWithAuthor[];
  currentUserId: string;
  canModerate: boolean;
  canWrite?: boolean;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(!compact);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CommentWithAuthor | null>(
    null
  );
  const [archiveReason, setArchiveReason] = useState("");
  const [editBody, setEditBody] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const idPrefix = useId();

  const scoped = comments;

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await addCommentAction(formData);
      if (result.ok) {
        formRef.current?.reset();
        toast.success("Comment added");
      } else {
        toast.error(result.error);
      }
    });
  }

  function archive(comment: CommentWithAuthor) {
    startTransition(async () => {
      const result = await archiveCommentAction(
        comment.id,
        comment.version,
        archiveReason
      );
      if (result.ok) {
        setArchiveTarget(null);
        setArchiveReason("");
        toast.success("Comment archived");
      } else {
        toast.error(result.error);
      }
    });
  }

  function saveEdit(comment: CommentWithAuthor) {
    startTransition(async () => {
      const result = await updateCommentAction(
        comment.id,
        comment.version,
        editBody
      );
      if (result.ok) {
        setEditingId(null);
        toast.success("Comment updated");
      } else {
        toast.error(result.error);
      }
    });
  }

  if (compact && !expanded) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(true)}
        className="mt-2 px-2 text-xs text-muted-foreground"
      >
        <MessageSquare aria-hidden="true" />
        {scoped.length
          ? `${scoped.length} comment${scoped.length > 1 ? "s" : ""}`
          : canWrite
            ? "Add comment"
            : "Comments"}
      </Button>
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
                <div className="flex items-center gap-2">
                  {canWrite &&
                    c.author_id === currentUserId &&
                    editingId !== c.id && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditingId(c.id);
                        setEditBody(c.body);
                      }}
                      disabled={pending}
                      className="text-muted-foreground"
                      aria-label={`Edit comment by ${c.author?.full_name ?? "unknown author"}`}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                  )}
                  {canWrite &&
                    (c.author_id === currentUserId || canModerate) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setArchiveTarget(c);
                        setArchiveReason("");
                      }}
                      disabled={pending}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Archive comment by ${c.author?.full_name ?? "unknown author"}`}
                    >
                      <Archive aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
              {editingId === c.id ? (
                <div className="mt-2 space-y-2">
                  <Textarea
                    id={`${idPrefix}-edit-${c.id}`}
                    aria-label="Edit comment"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button type="button" size="sm" disabled={pending} onClick={() => saveEdit(c)}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                  {c.updated_at !== c.created_at && (
                    <span className="text-xs text-muted-foreground">
                      Edited {fmt(c.updated_at)}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form ref={formRef} action={submit} className="flex flex-col gap-2">
        <input type="hidden" name="lead_id" value={leadId} />
        <input type="hidden" name="entity_type" value={entityType} />
        {entityId && <input type="hidden" name="entity_id" value={entityId} />}
        <Textarea
          id={`${idPrefix}-new-comment`}
          aria-label="New comment"
          name="body"
          placeholder="Write a comment…"
          rows={compact ? 2 : 3}
          required
          maxLength={4_000}
          className="text-sm"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Posting…" : "Comment"}
          </Button>
        </div>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground" role="status">
          Claim this lead before adding or changing comments.
        </p>
      )}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setArchiveTarget(null);
            setArchiveReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this comment?</AlertDialogTitle>
            <AlertDialogDescription>
              The comment leaves the active thread, while its original content
              and archive reason remain in the audit history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-archive-reason`}>
              Reason for archiving
            </Label>
            <Textarea
              id={`${idPrefix}-archive-reason`}
              value={archiveReason}
              onChange={(event) => setArchiveReason(event.target.value)}
              placeholder="For example: duplicate note"
              required
              maxLength={500}
              rows={3}
              disabled={pending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep comment</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              disabled={pending || archiveReason.trim().length === 0}
              onClick={() => {
                if (archiveTarget) archive(archiveTarget);
              }}
            >
              {pending ? "Archiving…" : "Archive comment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
