## Summary

Describe the patient, billing, security, or operational behavior changed.

## Verification

- [ ] Authorization matrix considered for every affected read and write
- [ ] Direct/tampered Server Action input is rejected
- [ ] Database failure cannot leave partial state
- [ ] Keyboard and narrow-screen behavior checked
- [ ] Tests cover the changed rule
- [ ] `npm run check` passes
- [ ] Migration has a forward and rollback/containment plan
- [ ] No credentials or patient information are included
