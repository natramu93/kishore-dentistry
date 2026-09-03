"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileImage, Paperclip, Upload } from "lucide-react";
import {
  confirmClinicalAttachmentAction,
  prepareClinicalAttachmentsAction,
} from "@/actions/clinical-attachments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  CLINICAL_ATTACHMENT_CATEGORIES,
  CLINICAL_ATTACHMENT_CATEGORY_LABELS,
  CLINICAL_FILE_ACCEPT,
  MAX_CLINICAL_FILE_BYTES,
  MAX_CLINICAL_FILES_PER_BATCH,
  formatClinicalFileSize,
  normalizeClinicalFileMime,
  type ClinicalAttachmentCategory,
  type ClinicalAttachmentView,
  type ClinicalFileMimeType,
} from "@/lib/clinical-files";

type SelectedClinicalFile = {
  key: string;
  file: File;
  mimeType: ClinicalFileMimeType;
  category: ClinicalAttachmentCategory;
};

type UploadState = {
  label: string;
  state: "waiting" | "uploading" | "verifying" | "complete" | "error";
  message: string;
};

function fileKey(file: File, index: number): string {
  return `${file.name}:${file.size}:${file.lastModified}:${index}`;
}

export function ClinicalAttachmentPanel({
  caseSheetId,
  initialAttachments,
  canUpload = true,
}: {
  caseSheetId: string;
  initialAttachments?: ClinicalAttachmentView[];
  canUpload?: boolean;
}) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState(initialAttachments ?? []);
  const [selected, setSelected] = useState<SelectedClinicalFile[]>([]);
  const [defaultCategory, setDefaultCategory] =
    useState<ClinicalAttachmentCategory>("photograph");
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function chooseFiles(fileList: FileList | null) {
    setError("");
    setUploadStates({});
    const files = Array.from(fileList ?? []);
    if (files.length === 0) {
      setSelected([]);
      return;
    }
    if (files.length > MAX_CLINICAL_FILES_PER_BATCH) {
      setSelected([]);
      setError(`Choose no more than ${MAX_CLINICAL_FILES_PER_BATCH} files at a time.`);
      return;
    }

    const next: SelectedClinicalFile[] = [];
    for (const [index, file] of files.entries()) {
      if (file.size < 1) {
        setSelected([]);
        setError(`${file.name} is empty and cannot be uploaded.`);
        return;
      }
      if (file.size > MAX_CLINICAL_FILE_BYTES) {
        setSelected([]);
        setError(`${file.name} is larger than 25 MB.`);
        return;
      }
      const mimeType = normalizeClinicalFileMime(file.type, file.name);
      if (!mimeType) {
        setSelected([]);
        setError(
          `${file.name} is not a supported photograph, scan, X-ray, DICOM or PDF file.`
        );
        return;
      }
      next.push({
        key: fileKey(file, index),
        file,
        mimeType,
        category: defaultCategory,
      });
    }
    setSelected(next);
  }

  function setFileCategory(key: string, category: ClinicalAttachmentCategory) {
    setSelected((current) =>
      current.map((item) => (item.key === key ? { ...item, category } : item))
    );
  }

  function updateUploadState(key: string, value: UploadState) {
    setUploadStates((current) => ({ ...current, [key]: value }));
  }

  async function uploadSelected() {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setError("");
    setUploadStates(
      Object.fromEntries(
        selected.map((item) => [
          item.key,
          { label: item.file.name, state: "waiting", message: "Waiting" },
        ])
      )
    );

    const prepared = await prepareClinicalAttachmentsAction(
      caseSheetId,
      selected.map((item) => ({
        original_name: item.file.name,
        mime_type: item.mimeType,
        size_bytes: item.file.size,
        category: item.category,
      }))
    );

    if (!prepared.ok) {
      setBusy(false);
      setError(prepared.error);
      return;
    }
    if (prepared.uploads.length !== selected.length) {
      setBusy(false);
      setError("The upload could not be prepared. Please choose the files again.");
      return;
    }
    const preparedUploads = prepared.uploads;

    const supabase = createClient();
    const completedKeys = new Set<string>();
    let cursor = 0;
    let failureCount = 0;

    async function worker() {
      while (cursor < selected.length) {
        const index = cursor;
        cursor += 1;
        const item = selected[index];
        const upload = preparedUploads[index];
        if (!item || !upload) continue;

        updateUploadState(item.key, {
          label: item.file.name,
          state: "uploading",
          message: "Uploading securely…",
        });
        const { error: uploadError } = await supabase.storage
          .from(upload.bucket_id)
          .uploadToSignedUrl(upload.object_path, upload.token, item.file, {
            cacheControl: "0",
            contentType: upload.mime_type,
          });

        if (uploadError) {
          // Confirmation also closes the pending metadata record and removes a
          // partial object, if Storage received one before the error surfaced.
          await confirmClinicalAttachmentAction(upload.id);
          failureCount += 1;
          updateUploadState(item.key, {
            label: item.file.name,
            state: "error",
            message: "Upload failed. Try this file again.",
          });
          continue;
        }

        updateUploadState(item.key, {
          label: item.file.name,
          state: "verifying",
          message: "Checking file type and size…",
        });
        const confirmed = await confirmClinicalAttachmentAction(upload.id);
        if (!confirmed.ok) {
          failureCount += 1;
          updateUploadState(item.key, {
            label: item.file.name,
            state: "error",
            message: confirmed.error,
          });
          continue;
        }

        completedKeys.add(item.key);
        setAttachments((current) => [
          ...current.filter((entry) => entry.id !== confirmed.attachment.id),
          confirmed.attachment,
        ]);
        updateUploadState(item.key, {
          label: item.file.name,
          state: "complete",
          message: "Added to the case sheet",
        });
      }
    }

    await Promise.all(Array.from({ length: Math.min(2, selected.length) }, worker));
    setBusy(false);
    setSelected((current) => current.filter((item) => !completedKeys.has(item.key)));
    if (completedKeys.size > 0) {
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    }
    if (failureCount > 0) {
      setError(
        `${failureCount} file${failureCount === 1 ? "" : "s"} could not be added. You can try again.`
      );
    }
  }

  const liveMessage = Object.values(uploadStates)
    .map((item) => `${item.label}: ${item.message}`)
    .join(". ");

  return (
    <section className="space-y-3 rounded-lg border bg-muted/20 p-3" aria-labelledby={`${inputId}-title`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={`${inputId}-title`} className="flex items-center gap-2 font-medium">
            <Paperclip className="size-4" aria-hidden="true" />
            Clinical files
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Photographs, X-rays, scans, DICOM files and reports. Maximum 25 MB each.
          </p>
        </div>
        {attachments.length > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {attachments.length} file{attachments.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {attachments.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <a
                href={`/clinical-files/${attachment.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <FileImage className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{attachment.original_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {CLINICAL_ATTACHMENT_CATEGORY_LABELS[attachment.category]} ·{" "}
                    {formatClinicalFileSize(attachment.size_bytes)}
                  </span>
                </span>
                <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                <span className="sr-only">Open secure clinical file</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No clinical files added yet.</p>
      )}

      {canUpload && (
        <div className="space-y-3 border-t pt-3">
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <div className="space-y-2">
              <Label htmlFor={`${inputId}-category`}>Default file category</Label>
              <select
                id={`${inputId}-category`}
                value={defaultCategory}
                onChange={(event) =>
                  setDefaultCategory(event.target.value as ClinicalAttachmentCategory)
                }
                disabled={busy}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              >
                {CLINICAL_ATTACHMENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CLINICAL_ATTACHMENT_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${inputId}-files`}>Choose clinical files</Label>
              <Input
                ref={inputRef}
                id={`${inputId}-files`}
                type="file"
                multiple
                accept={CLINICAL_FILE_ACCEPT}
                onChange={(event) => chooseFiles(event.currentTarget.files)}
                disabled={busy}
                className="h-auto min-h-11 py-1.5 file:mr-3"
              />
            </div>
          </div>

          {selected.length > 0 && (
            <ul className="space-y-2" aria-label="Files selected for upload">
              {selected.map((item) => {
                const progress = uploadStates[item.key];
                return (
                  <li key={item.key} className="grid gap-2 rounded-lg border bg-background p-2 sm:grid-cols-[1fr_11rem] sm:items-center">
                    <div className="min-w-0 text-sm">
                      <span className="block truncate font-medium">{item.file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatClinicalFileSize(item.file.size)}
                        {progress ? ` · ${progress.message}` : ""}
                      </span>
                    </div>
                    <select
                      aria-label={`Category for ${item.file.name}`}
                      value={item.category}
                      onChange={(event) =>
                        setFileCategory(
                          item.key,
                          event.target.value as ClinicalAttachmentCategory
                        )
                      }
                      disabled={busy}
                      className="h-11 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {CLINICAL_ATTACHMENT_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {CLINICAL_ATTACHMENT_CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {liveMessage}
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={uploadSelected}
              disabled={busy || selected.length === 0}
            >
              <Upload aria-hidden="true" />
              {busy
                ? "Adding files…"
                : selected.length > 0
                  ? `Add ${selected.length} file${selected.length === 1 ? "" : "s"}`
                  : "Add files"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
