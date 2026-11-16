"""Organization invitations (emailed, personal) and invite codes (shared).

- ``policy``: who may invite, which roles, groups and courses they may grant,
  plan capacity, tokens and the small helpers both flows share.
- ``service``: the admin side of email invitations (send, list, resend, copy
  link, edit while pending, revoke, bulk).
- ``codes``: shareable invite codes with a default role, groups, courses, a
  use cap and an expiry.
- ``apply``: what happens when someone arrives through either one: the
  membership with the chosen role, the groups and the course enrollments in
  one commit, then the audit entries and the inviter's notification.
"""
