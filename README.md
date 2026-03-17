## AdvancedJobQueue Features

The `AdvancedJobQueue` class provides a robust, production‑ready job queue with the following capabilities:

- **Priority‑based execution** – Jobs are assigned a numeric priority (lower number = higher priority). The queue always picks the highest‑priority job next.
- **Concurrency control** – Limits the number of jobs running simultaneously (configurable via `concurrency`).
- **Persistence & Crash Recovery** – All job state changes are written to an append‑only log. On restart, the queue replays the log to rebuild its state. Periodic checkpoints reduce log replay time.
- **Dead Letter Queue (DLQ)** – Jobs that exhaust all retries are moved to a persistent DLQ for later inspection.
- **Delayed Retries with Backoff** – Failed jobs can be retried after a delay. Supports exponential backoff, jitter, and maximum delay limits.
- **Per‑Job Timeouts** – Each job can have a timeout; if it exceeds that time, it is automatically failed.
- **Event Emission** – Emits events (`enqueued`, `started`, `completed`, `failed`, `retry`, `error`) for easy monitoring and integration.
- **Graceful Shutdown** – The `close()` method waits for all pending and active jobs to finish, writes a final checkpoint, and closes log files.
- **Scalable Priority Queue** – Uses a bucketed priority queue (by priority level) with a min‑heap of active priorities, providing O(1) enqueue and O(log P) dequeue (where P is the number of distinct priorities).

---

## Best Data Structure / Technical Skill: ScalablePriorityQueue

The `ScalablePriorityQueue` is a standout data structure in this implementation. It combines **bucketing by priority** with a **min‑heap of active priority levels**.

**Advantages:**
- **Constant‑time enqueue** – Jobs are simply pushed into the bucket corresponding to their priority.
- **Logarithmic‑time dequeue** – The min‑heap tracks which priority levels currently contain jobs; extracting the smallest priority is O(log P), where P is the number of *distinct* priorities (typically small). Once the priority is known, the job is taken from the front of that bucket (O(1)).
- **Excellent scalability** – For queues with many jobs but a limited priority range, performance remains high because per‑job comparisons are avoided.
- **Simplifies persistence** – The bucket structure can be flattened to an array for checkpointing and rebuilt efficiently.

This design is a clear example of optimising a common pattern (priority queue) by exploiting domain knowledge (priorities are integers in a known range).

---

## How to Use AdvancedJobQueue – A Practical Guide

### Installation

The code assumes an ES module environment. Ensure you have the following files in your project:
- `AdvancedJobQueue.js`
- `DeadLetterQueue.js`
- `DelayedJobQueue.js`
- `Job.js`
- `PriorityQueue.js`
- `ScalablePriorityQueue.js`
- `MinHeap.js`

Install no external dependencies (all are native Node.js modules).

### Quick Start

```javascript
import DeadLetterQueue from './DeadLetterQueue.js';
import AdvancedJobQueue from './AdvancedJobQueue.js';

// Create a dead letter queue (optional, but recommended)
const dlq = new DeadLetterQueue({ logPath: './logs/deadletter.log' });

// Create the main job queue
const queue = new AdvancedJobQueue({
  concurrency: 2,                 // run up to 2 jobs simultaneously
  logPath: './logs/queue.log',    // enable persistence
  deadLetterQueue: dlq,
  timeoutCheckIntervalMs: 200     // check for timeouts every 200ms
});

// Listen to events
queue.on('enqueued', job => console.log(`Enqueued ${job.id}`));
queue.on('completed', (job, result) => console.log(`Completed ${job.id}: ${result}`));
queue.on('failed', (job, err) => console.log(`Failed ${job.id}: ${err.message}`));

// Add a simple job
queue.enqueue(
  () => new Promise(resolve => setTimeout(() => resolve('Hello'), 1000))
);
```

## Configuration Options
When creating an `AdvancedJobQueue`, you can pass an options object:

| Option                    | Default | Description |
|---------------------------|---------|-------------|
| `concurrency`             | `1`     | Maximum number of jobs running at the same time. |
| `deadLetterQueue`         | `null`  | An instance of `DeadLetterQueue` to receive permanently failed jobs. |
| `logPath`                 | `null`  | File path for the persistent log. If omitted, persistence is disabled. |
| `checkpointInterval`      | `1000`  | Number of operations between checkpoints (to limit log replay). |
| `timeoutCheckIntervalMs`  | `100`   | How often (in ms) to scan for timed‑out jobs. |


## Adding Jobs
The `enqueue(task, options)` method accepts a task function (must return a promise) and an optional options object:

```javascript
queue.enqueue(
  () => fetch('https://api.example.com/data').then(res => res.json()),
  {
    priority: 1,                // lower = higher priority
    maxRetries: 3,              // retry up to 3 times
    timeout: 5000,              // fail if not completed in 5 seconds
    retryDelay: 1000,           // base delay before first retry
    backoffMultiplier: 2,       // exponential backoff factor
    maxRetryDelay: 30000,       // cap delay at 30 seconds
    jitter: true                // add random jitter to delays
  }
);
```

All options except task are optional and default to sensible values.

## Priority Example
```javascript
// High priority (1) – runs before others
queue.enqueue(() => longTask(), { priority: 1 });

// Low priority (10) – runs only when no higher‑priority jobs are pending
queue.enqueue(() => backgroundTask(), { priority: 10 });
```

## Retries and Timeouts
```javascript
// A job that may fail transiently
queue.enqueue(
  () => unstableNetworkCall(),
  {
    maxRetries: 3,
    retryDelay: 500,            // first retry after 500ms
    backoffMultiplier: 2,       // then 1000ms, then 2000ms
    timeout: 2000                // each attempt must finish within 2s
  }
);
```


## Persistence and Recovery
When `logPath` is provided, all state changes are logged. If the process crashes and restarts, the queue automatically recovers:

```javascript
// After restart, the queue will reload pending jobs from the log
const queue = new AdvancedJobQueue({ logPath: './logs/queue.log' });
```
No additional code is needed – recovery is automatic.

## Dead Letter Queue
Permanently failed jobs are sent to the `DeadLetterQueue``. You can inspect them later:

```javascript
const dlq = new DeadLetterQueue({ logPath: './logs/deadletter.log' });

// ... after some jobs have failed permanently ...

console.log(dlq.getAll());               // plain objects
console.log(dlq.getAllAsJobs());          // reconstructed Job instances
await dlq.clear();                        // remove all dead letters
```

## Handling Events
The queue emits the following events:

| Event       | Arguments                 | Description |
|-------------|---------------------------|-------------|
| `enqueued`  | `job`                     | A new job has been added to the queue. |
| `started`   | `job`                     | A job has started execution. |
| `completed` | `job`, `result`           | A job completed successfully. |
| `failed`    | `job`, `error`            | A job failed permanently and was moved to the DLQ. |
| `retry`     | `job`, `error`            | A job failed but will be retried later. |
| `error`     | `err`                     | An internal error occurred (e.g., logging failure). |
| `ready`     | –                         | Emitted after the queue has recovered from the log and is ready. |

## Graceful Shutdown
Always call `close()` before exiting to ensure all jobs finish and the final checkpoint is written:

```javascript
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await queue.close();
  await dlq.close();   // if you have a DLQ
  process.exit(0);
});
```

## Advanced: Custom Job Serialization
The persistence mechanism stores job metadata but not the task function itself. In a real application, you should store a task identifier and any parameters, and recreate the task function during recovery. The current implementation assumes you can rebuild tasks from context (e.g., by using a registry of known task functions).

## Summary
`AdvancedJobQueue` is a feature‑rich, resilient job queue suitable for Node.js applications that require priorities, retries, persistence, and monitoring. Its use of a bucketed priority queue ensures excellent performance even under high load. By following the patterns shown above, you can integrate it into a wide range of use cases – from simple background processing to complex, failure‑tolerant workflows.