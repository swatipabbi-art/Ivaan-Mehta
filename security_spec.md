# FormLab Firestore Security Specification

## 1. Data Invariants
1. **Verified Identity & Owner Bootstrapping**: Only verified Google Sign-In users (`request.auth.token.email_verified == true`) may create or mutate documents. Only `swatipabbi@gmail.com` (with `email_verified == true`) or an entry in `/admins/{uid}` has `isAdmin()` privileges.
2. **Self-Promotion & Free-Pro Bypass Prevention**: A non-admin user creating or updating `/users/{userId}` cannot set `role: 'owner'` or `proActive: true`. Only the verified owner (`swatipabbi@gmail.com`) may hold `role: 'owner'` or grant `proActive: true` to another user.
3. **PII Isolation**: User email addresses are stored in `/users/{userId}/private/info` and are readable only by the document owner or `isAdmin()`.
4. **Pro Access Request Integrity & Terminal State Locking**: Paid Pro requests in `/proRequests/{requestId}` can only be created with `status: 'pending'` and `uid == request.auth.uid`. Only `isAdmin()` can transition `status` from `'pending'` to `'approved'` or `'rejected'`, and terminal states cannot be altered afterward.
5. **Temporal Integrity & Strict Keys**: Every create/update validates `request.time` on `createdAt`/`updatedAt`, enforces `keys().hasAll(...)` + `keys().hasOnly(...)` on create, and uses `affectedKeys().hasOnly(...)` on update.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: `PERMISSION_DENIED`)
1. Unauthenticated read/write to `/users/user123`.
2. Spoofed email (`email: 'swatipabbi@gmail.com'`, `email_verified: false`) attempting admin read/write.
3. Non-admin creating `/users/{uid}` with `proActive: true`.
4. Non-admin creating `/users/{uid}` with `role: 'owner'`.
5. Non-admin updating `/users/{uid}` with `proActive: true` (privilege escalation).
6. Shadow field injection (`extraAdminFlag: true`) on `/users/{uid}` create or update.
7. Cross-user PII read on `/users/{otherUid}/private/info`.
8. Unverified/wrong `uid` on `/proRequests/{reqId}` create (`uid: 'someone_else'`).
9. Creating `/proRequests/{reqId}` directly with `status: 'approved'` instead of `'pending'`.
10. Non-admin attempting to update `/proRequests/{reqId}` status to `'approved'`.
11. Mutating an already `'approved'` or `'rejected'` request in `/proRequests/{reqId}` (terminal state bypass).
12. Blanket `list` scraping of `/proRequests` by a non-admin without filtering `uid == request.auth.uid`.
