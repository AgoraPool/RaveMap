# Admin Usage

1. Open `/admin`.
2. Enter `ADMIN_SECRET` and unlock the cockpit.
3. Use the editor to create a public-only or code-gated event.
4. Save as draft or publish immediately.
5. Use the inventory table to edit, publish drafts, open live events, or delete by slug confirmation.
6. Use the mirror panel to preview or sync Jiri Petrak events into public-only drafts.
7. Use diagnostics to verify relay reads and write quorum configuration.

Mirrored events are never published immediately. They enter admin as public-only drafts and can be reviewed, edited, published, or deleted.

# Organizer Studio

1. Open `/studio`.
2. Enter `ORGANIZER_SECRET`.
3. Create or edit only studio-created events.
4. Use the guided steps to prepare public info, optional code-gated details, and preview the public/secret split.
5. Save as draft, publish, or archive.

Studio does not expose imports, relay diagnostics, bulk deletion, or non-studio events.
