-- Distinguishes how an investigation entered the queue. Null means the
-- existing behavior (Sentry webhook or direct sauron-errors ingest) —
-- eligible for the daily automatic cron, same as always. 'log-sweep' rows
-- come from a cheap passive log scan, not a real reported error, and must
-- never be auto-run without a human deciding to — see runNextAutoInvestigation.
alter table investigations add column if not exists origin text;
