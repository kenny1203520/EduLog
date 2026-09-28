# Teaching role inheritance and teacher assignment

Effective teaching access is resolved at request time along the platform → classroom → class-session path. The deepest grant or exclusion for each role wins, then role-parent inheritance and permission policies are applied. No copies of platform grants are written to child scopes.

Class-session teacher assignments are a separate roster concept. A linked teacher account receives the selected teaching role only for that class session and the assignment's effective dates. The grant records its assignment source, so changing or removing that assignment removes only that source. Independent platform, classroom, or class-session grants remain intact. Unlinked teacher records remain roster entries without account permissions.

Creating an enrollment requires permission to read the student and `teaching.enrollments.create` at the destination scope. It does not require enrollment-create access to the student's previous class.

Migration `1000110_teaching_role_sources_and_enrollment_visibility.sql` installs the role-source synchronization and the effective-role read RPC. Apply it after `1000109` in the normal append-only migration chain.
