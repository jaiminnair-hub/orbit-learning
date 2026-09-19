-- Drop 'aicc' from published_packages.format's allowed values.
--
-- AICC was removed from the build and roadmap entirely (2026-09-03,
-- product decision): it predates SCORM, most AICC content in the wild has
-- long since moved to SCORM 1.2, and modern authoring tools rarely export
-- it anymore. No row has ever used format = 'aicc' -- the export pipeline
-- named it unimplemented in code from day one (lib/publishing/build.ts)
-- and never built a packager for it, so this is a safe, no-op-on-data
-- constraint change, not a migration of real rows.

alter table published_packages drop constraint published_packages_format_check;
alter table published_packages add constraint published_packages_format_check
  check (format in ('scorm12', 'scorm2004', 'xapi', 'cmi5'));
