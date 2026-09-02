# Git history cleanup

Historical revisions of both `README.md` and `apphosting.yaml` must be treated
as sensitive. Cleaning the current files or deleting a branch does not remove
values from commits, tags, pull-request refs, forks, caches, artifacts, or
existing clones.

History rewriting is not incident containment. **Rotate exposed credentials
and revoke sessions first. Do not rewrite or force-push until those actions
are complete and the old credentials have been verified unusable.**

This procedure is a coordinated repository-owner operation. It changes commit
IDs, invalidates open work, and requires every collaborator and automation
owner to discard the old history.

## Phase 1: contain before touching history

Assign an incident owner and record sensitive details only in an approved
restricted incident system. Do not copy an exposed value into a ticket, chat,
replacement rule, command line, commit message, or this document.

1. Restrict the affected application and repository access as needed.
2. Inventory every credential, account, project identifier, authentication
   link, or patient datum that may have appeared in either file or a derivative
   artifact. Record only secret names, owners, and rotation status.
3. Rotate each exposed credential at its source:

   - replace exposed user passwords and require individual recovery;
   - rotate exposed Supabase privileged keys;
   - replace affected Firebase or Google credentials;
   - revoke any exposed authentication factor; and
   - invalidate invitation/recovery links where supported, otherwise contain
     the account until the one-time link has expired and recovery is complete.

4. Update the corresponding Firebase managed-secret versions, grant access
   only to the intended App Hosting backend, and deploy a reviewed revision.
5. Revoke all sessions for every affected user. If the exposure scope is
   uncertain or a privileged server credential was exposed, revoke all
   application user sessions and require fresh sign-in.
6. Confirm from a separate trusted client that every replaced credential and
   session is rejected. Review Auth, Admin, application, and database logs for
   misuse.
7. Remove sensitive artifacts from the current working tree, build output, CI
   logs, release artifacts, package registries, caches under your control, and
   deployment configuration.

The incident owner must sign off on credential rotation, managed-secret
rollout, old-value rejection, and session revocation before Phase 2 begins.

## Phase 2: prepare the coordinated rewrite

1. Notify all collaborators and automation owners. Pause merges, releases,
   branch creation, scheduled jobs that push to Git, and dependency bots.
2. Record the complete set of remote branches, tags, protected refs, open pull
   requests, forks, release artifacts, and deployment integrations.
3. Store clean, reviewed copies of the current `README.md` and
   `apphosting.yaml` outside the repository. Confirm they contain only
   placeholders and managed-secret references.
4. Create an access-controlled backup of the original repository for the
   incident owner only. The backup still contains the exposure and must have a
   retention and destruction date.
5. Start from a fresh owner-controlled clone after the pause. Do not perform
   the rewrite from a collaborator's long-lived working clone.
6. Fetch and materialize every remote branch and tag as a rewrite ref, or use a
   fresh mirror clone with a separate clean worktree for the sanitized restore.
   A shallow, partial, or default-branch-only clone is not sufficient.
7. Arrange the temporary protected-branch exception and repository-host
   permissions needed for the owner to replace every affected branch and tag.

If complete control of branches, tags, forks, or required integrations is not
available, stop and involve the repository host or organization administrator.

## Phase 3: remove both files from old commits

Install and verify `git-filter-repo` from its trusted distribution. In the
fresh rewrite clone, remove both paths from all rewritten history:

```bash
git filter-repo \
  --path README.md \
  --path apphosting.yaml \
  --invert-paths \
  --force
```

On PowerShell, use the same arguments on one line:

```powershell
git filter-repo --path README.md --path apphosting.yaml --invert-paths --force
```

`git-filter-repo` may remove the `origin` remote as a safety measure. Re-add
only the already verified canonical remote; do not paste a remote URL
containing credentials.

Restore the two sanitized current files from the external reviewed copies,
then commit them as new content:

```bash
git add README.md apphosting.yaml
git commit -m "Restore sanitized project and hosting configuration"
```

Before any push:

1. inspect the rewritten branch and tag inventory;
2. search the current tree and full local history with the repository's
   approved secret scanner in redacted mode;
3. inspect both path histories and confirm no old revision remains;
4. verify that the sanitized `apphosting.yaml` uses managed-secret references,
   with the service role available only at runtime; and
5. run documentation, configuration, application, and deployment validation on
   the rewritten default branch.

Do not use value-based replacement rules. Removing the complete paths avoids
putting the old values into a filter specification or terminal history.

## Phase 4: coordinated force-push

During the announced maintenance window, the repository owner must:

1. force-push the rewritten default branch and every other rewritten branch;
2. force-push every rewritten tag;
3. verify the remote commit IDs match the reviewed rewritten refs;
4. recreate rather than reuse open pull requests and stale release branches;
5. restore protected-branch rules and resume automation only after validation;
   and
6. run the full-history secret-scan workflow against the rewritten remote.

Use lease protection where the hosting and ref workflow support it, but do not
mistake a normal push for completion: rewritten refs require an explicitly
authorized force-push. If any ref changed after the maintenance pause, stop,
reconcile it, and repeat validation rather than overriding unreviewed work.

Deleting old branches after pushing the default branch is not sufficient.
Every reachable branch, tag, pull-request ref, fork, release artifact, and
cache must be reviewed.

## Phase 5: invalidate old copies

1. Require every collaborator and build agent to delete the old clone and make
   a fresh clone. Do not fetch, merge, cherry-pick, or rebase work from the old
   history into the clean repository.
2. Recreate necessary work manually or as reviewed patches whose content has
   been scanned.
3. Delete stale CI caches, artifacts, preview deployments, and local bundles
   that contain the old repository.
4. Contact the repository host to purge cached commit or pull-request views
   that remain accessible. Coordinate separately with fork owners.
5. Run another full-history scan from a new clone and confirm both removed path
   histories are absent.
6. Continue monitoring authentication and privileged activity. History cleanup
   does not reduce the need to investigate use of a credential before it was
   rotated.
7. Destroy the restricted original-history backup on its recorded date unless
   legal or incident-response retention requires continued controlled storage.

## Completion evidence

The incident can close only when the record shows:

- each affected credential was rotated and its old value rejected;
- affected or global sessions were revoked as appropriate;
- managed-secret versions and backend grants were deployed and verified;
- `README.md` and `apphosting.yaml` were removed from old commits and restored
  only as sanitized current files;
- every branch and tag was replaced;
- collaborators and automation use fresh clones;
- repository-host caches and forks were addressed; and
- a full-history scan from a fresh clone passed.
