-- Records which model/effort an investigation actually ran with, so the
-- dashboard (and you, auditing cost later) can see it after the fact.
alter table investigations add column if not exists model text;
alter table investigations add column if not exists effort text;
