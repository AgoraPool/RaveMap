# Admin Usage

1. Open `/admin`.
2. Enter `ADMIN_SECRET` and unlock the cockpit.
3. Use the editor to create a public-only or code-gated event.
4. Save as draft or publish immediately.
5. Use the inventory table to edit, publish drafts, open live events, or delete by slug confirmation.
6. Use the mirror panel to preview or sync Jiri Petrak events into public-only drafts.
7. Use diagnostics to verify relay reads and write quorum configuration.

Mirrored events are never published immediately. They enter admin as public-only drafts and can be reviewed, edited, published, or deleted.

# Invite a Crew

1. Open the crew panel in `/admin`.
2. Enter a crew slug. Name, summary, avatar, banner, website, SimpleX, and Lightning are optional.
3. Click `Generovat kód` for a safe one-time crew code.
4. Save the crew profile.
5. Click `Kopírovat pozvánku` and send it only to the trusted crew contact.
6. Rotate the crew code from admin if the invite is exposed or the crew contact changes.

# Crew Studio

1. Open `/studio`.
2. Enter the crew slug and crew code from the invite.
3. Use the guided first-publish editor to prepare public info.
4. For a code-gated first event, fill the unlock code, secret info, secret location name, and both secret coordinates.
5. Save as draft, publish, or archive only that crew's events.
6. After publish, open the event detail and public crew page from the success links.

Studio does not expose imports, relay diagnostics, bulk deletion, or non-studio events.

## First Event Checklist

- Public event: title, start time, public location, and public description.
- Optional public context: end time, public coordinates, poster URL, external link, SimpleX, genres, lineup, and tags.
- Code-gated event: unlock code, secret info, secret location name, secret latitude, and secret longitude.
- Save a draft first if the crew wants to review wording before publishing.
- Publish only when the readiness panel says the public part and gated layer are ready.
