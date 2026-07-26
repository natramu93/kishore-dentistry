import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const actionMocks = vi.hoisted(() => ({
  add: vi.fn(),
  archive: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/actions/leads", () => ({
  addCommentAction: actionMocks.add,
  archiveCommentAction: actionMocks.archive,
  updateCommentAction: actionMocks.update,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CommentThread } from "@/components/comment-thread";
import type { CommentWithAuthor } from "@/data/comments";

const comment: CommentWithAuthor = {
  id: "10000000-0000-4000-8000-000000000001",
  lead_id: "10000000-0000-4000-8000-000000000002",
  branch_id: "10000000-0000-4000-8000-000000000003",
  entity_type: "lead",
  entity_id: null,
  body: "Original patient note",
  author_id: "10000000-0000-4000-8000-000000000004",
  created_at: "2026-07-26T05:00:00.000Z",
  updated_at: "2026-07-26T05:00:00.000Z",
  deleted_at: null,
  deleted_by: null,
  delete_reason: null,
  version: 7,
  author: {
    full_name: "Front Office User",
    role: "front_office",
  },
};

beforeEach(() => {
  actionMocks.add.mockReset().mockResolvedValue({ ok: true });
  actionMocks.archive.mockReset().mockResolvedValue({ ok: true });
  actionMocks.update.mockReset().mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("comment history controls", () => {
  it("sends the rendered version with an edit", async () => {
    render(
      <CommentThread
        leadId={comment.lead_id}
        comments={[comment]}
        currentUserId={comment.author_id}
        canModerate={false}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit comment by Front Office User" })
    );
    fireEvent.change(screen.getByLabelText("Edit comment"), {
      target: { value: "Revised patient note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(actionMocks.update).toHaveBeenCalledWith(
        comment.id,
        7,
        "Revised patient note"
      );
    });
  });

  it("requires an archive reason and sends it with the rendered version", async () => {
    render(
      <CommentThread
        leadId={comment.lead_id}
        comments={[comment]}
        currentUserId={comment.author_id}
        canModerate={false}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Archive comment by Front Office User",
      })
    );

    const confirm = screen.getByRole("button", { name: "Archive comment" });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for archiving"), {
      target: { value: "Duplicate patient note" },
    });
    expect(confirm).toBeEnabled();

    const accessibility = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      accessibility.violations,
      accessibility.violations
        .map((violation) => `${violation.id}: ${violation.help}`)
        .join("\n")
    ).toEqual([]);

    fireEvent.click(confirm);

    await waitFor(() => {
      expect(actionMocks.archive).toHaveBeenCalledWith(
        comment.id,
        7,
        "Duplicate patient note"
      );
    });
  });

  it("renders an unassigned Front Office thread as read-only", () => {
    render(
      <CommentThread
        leadId={comment.lead_id}
        comments={[comment]}
        currentUserId={comment.author_id}
        canModerate={false}
        canWrite={false}
      />
    );

    expect(screen.getByText("Original patient note")).toBeInTheDocument();
    expect(
      screen.getByText("Claim this lead before adding or changing comments.")
    ).toHaveAttribute("role", "status");
    expect(screen.queryByLabelText("New comment")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Edit comment by Front Office User",
      })
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Archive comment by Front Office User",
      })
    ).toBeNull();
  });
});
