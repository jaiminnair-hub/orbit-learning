-- Orbit Foundation Phase 1: product catalogue and initial role vocabulary.
-- Product entitlement rows are deliberately NOT seeded. A product becomes
-- visible only after a commercial/admin workflow creates an entitlement.

insert into public.products (product_key, name, description) values
  ('lms', 'Learning Management System', 'Learning, authoring, assignments, and compliance.'),
  ('feedback', '360 Degree Feedback', 'Confidential multi-rater feedback and development actions.'),
  ('growth', 'Orbit Growth', 'Performance, goals, and growth conversations.'),
  ('competencies', 'Competency Management', 'Competency frameworks, assessments, and readiness.')
on conflict (product_key) do update
  set name = excluded.name,
      description = excluded.description;

insert into public.product_roles (product_key, role_key, name, description) values
  ('lms', 'learner', 'Learner', 'Completes assigned learning.'),
  ('lms', 'l_and_d_admin', 'L&D administrator', 'Administers learning for the organization.'),
  ('lms', 'content_author', 'Content author', 'Creates and edits learning content.'),
  ('lms', 'instructor', 'Instructor', 'Delivers and facilitates learning.'),
  ('lms', 'learning_manager', 'Learning manager', 'Monitors learner progress and assignments.'),
  ('feedback', 'feedback_admin', 'Feedback administrator', 'Creates and administers feedback cycles.'),
  ('feedback', 'subject', 'Feedback subject', 'Receives feedback in assigned cycles.'),
  ('feedback', 'reviewer', 'Reviewer', 'Provides feedback only where assigned by a cycle.'),
  ('feedback', 'coach', 'Coach', 'Supports development where explicitly assigned.'),
  ('feedback', 'report_viewer', 'Report viewer', 'Views reports where product rules allow.'),
  ('growth', 'performance_admin', 'Performance administrator', 'Administers performance cycles.'),
  ('growth', 'manager', 'Performance manager', 'Runs reviews for direct reports.'),
  ('growth', 'employee', 'Performance employee', 'Participates in own performance workflow.'),
  ('growth', 'review_calibrator', 'Review calibrator', 'Participates in authorized calibration.'),
  ('competencies', 'competency_admin', 'Competency administrator', 'Administers competency management.'),
  ('competencies', 'framework_author', 'Framework author', 'Creates competency frameworks.'),
  ('competencies', 'assessor', 'Assessor', 'Performs authorized competency assessments.'),
  ('competencies', 'employee', 'Competency employee', 'Views and develops own competency profile.')
on conflict (product_key, role_key) do update
  set name = excluded.name,
      description = excluded.description;
