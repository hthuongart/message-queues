# message-queues
Build a memory queues with more robust features suitable for many real‑world scenarios: priority, retries, timeout, and persistence

# Features Overview
- Priority – Jobs with higher priority (lower numeric value) are processed before lower‑priority ones.
- Retries – A failed job can be retried up to a configurable number of times before being considered permanently failed.
- Timeout – Each job can have a maximum execution time; if it exceeds that limit, it's treated as a failure.
- Persistence – The queue state is saved to disk by incremental logging so that jobs survive a process restart.