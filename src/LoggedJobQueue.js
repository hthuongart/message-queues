import { EventEmitter } from 'events';
import readline from 'readline';
import fsSync from 'fs';
import Job from './Job.js';
import PriorityQueue from './PriorityQueue.js';
import DelayedJobQueue from './DelayedJobQueue.js';

class LoggedJobQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency = options.concurrency || 1;
    this.priorityQueue = new PriorityQueue(); // same as before
    this.delayedJobQueue = new DelayedJobQueue(this);
    this.activeJobs = new Map();
    this.currentJobs = 0;
    this.logPath = options.logPath || './queue.log';
    this.logStream = null;
    this.checkpointInterval = options.checkpointInterval || 1000; // ops between checkpoints
    this.opsSinceCheckpoint = 0;

    this._initialize(); // now synchronous
  }

  _initialize() {
    this._recoverFromLog(); // now synchronous
    // Open log in append mode
    this.logStream = fsSync.createWriteStream(this.logPath, { flags: 'a' });
    this.emit('ready');
    this._processNext();
  }

  // --- Logging methods ---
  _appendLog(entry) {
    return new Promise((resolve, reject) => {
      const line = JSON.stringify(entry) + '\n';
      this.logStream.write(line, 'utf8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async _logEnqueue(job) {
    await this._appendLog({
      type: 'enqueue',
      timestamp: Date.now(),
      job: {
        id: job.id,
        priority: job.priority,
        maxRetries: job.maxRetries,
        retriesLeft: job.retriesLeft,
        timeout: job.timeout,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        status: job.status
        // task is not serializable – we assume task is recreated from a known function map in production
        // For demo, we'll omit task and rely on the user to provide idempotent task definitions.
        // In real life, you'd store task name/parameters instead.
      }
    });
    this.opsSinceCheckpoint++;
    if (this.opsSinceCheckpoint >= this.checkpointInterval) {
      await this._checkpoint();
    }
  }

  async _logDequeue(jobId) {
    await this._appendLog({ type: 'dequeue', timestamp: Date.now(), jobId });
    this.opsSinceCheckpoint++;
  }

  async _logComplete(jobId, result) {
    await this._appendLog({ type: 'complete', timestamp: Date.now(), jobId, result });
    this.opsSinceCheckpoint++;
  }

  async _logFail(jobId, error, willRetry) {
    await this._appendLog({ type: 'fail', timestamp: Date.now(), jobId, error: error.message, willRetry });
    this.opsSinceCheckpoint++;
  }

  async _checkpoint() {
    // Write a full snapshot of the queue state
    const snapshot = {
      type: 'checkpoint',
      timestamp: Date.now(),
      queue: this.priorityQueue.toArray(), // array of jobs
      activeJobs: Array.from(this.activeJobs.values()),
      currentJobs: this.currentJobs
    };
    await this._appendLog(snapshot);
    this.opsSinceCheckpoint = 0;
    // In a real system, you'd truncate the log before this point
  }

  // --- Recovery: rebuild state from log ---
  _recoverFromLog() {
    if (!fsSync.existsSync(this.logPath)) return;

    const content = fsSync.readFileSync(this.logPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    const entries = lines.map(line => JSON.parse(line));

    let lastCheckpoint = null;
    for (const entry of entries) {
      if (entry.type === 'checkpoint') {
        lastCheckpoint = entry;
      }
    }

    // If we have a checkpoint, start from there; otherwise start empty
    if (lastCheckpoint) {
      // Convert plain objects back to Job instances
      const queueJobs = lastCheckpoint.queue.map(jobData => new Job(() => {}, jobData));
      this.priorityQueue = PriorityQueue.fromArray(queueJobs);
      // active jobs from checkpoint are considered stale, we'll re-enqueue them as pending
      lastCheckpoint.activeJobs.forEach(jobData => {
        const job = new Job(() => {}, jobData);
        job.status = 'pending';
        this.priorityQueue.enqueue(job);
      });
      this.currentJobs = 0;
      // Now replay only entries after the checkpoint
      const startIdx = entries.findIndex(e => e === lastCheckpoint) + 1;
      for (let i = startIdx; i < entries.length; i++) {
        this._replayEntry(entries[i]);
      }
    } else {
      // No checkpoint: replay all entries
      for (const entry of entries) {
        this._replayEntry(entry);
      }
    }
  }

  _replayEntry(entry) {
    switch (entry.type) {
      case 'enqueue': {
        // Recreate job object (task omitted)
        const job = new Job(() => {console.log('Recovery')}, entry.job); // we pass the saved fields
        this.priorityQueue.enqueue(job);
        break;
      }
      case 'dequeue': {
        // We need to find and remove the job from the queue – but priority queue doesn't support removal by ID.
        // In a real system you'd have a separate index. For this example, we'll assume dequeue only happens
        // when a job starts, and we have it in activeJobs. But during recovery, we may have active jobs
        // from before a crash. Simpler: ignore dequeue entries and rely on checkpoint + enqueue/complete/fail.
        // Let's keep it basic: we'll just note that the job was removed.
        // We'll not modify the queue here because we already rebuilt from checkpoint.
        break;
      }
      case 'complete': {
        // Mark job as completed (if still in queue? likely not)
        // We could remove it from activeJobs if we track it.
        break;
      }
      case 'fail': {
        // Similar to complete
        break;
      }
      case 'checkpoint':
        // already handled
        break;
    }
  }

  // --- Public API (modified to log) ---
  enqueue(task, options = {}) {
    const job = new Job(task, options);
    // Add to queue immediately
    this.priorityQueue.enqueue(job);
    this._logEnqueue(job).catch(err => this.emit('error', err));
    this.emit('enqueued', job);
    this._processNext();
    return job.id;
  }

  _processNext() {
    // same as before, but when we dequeue/complete/fail, we also log those events
    if (this.currentJobs >= this.concurrency) return;

    const job = this.priorityQueue.dequeue();
    if (!job) return;

    // Log dequeue (job moved to active)
    this._logDequeue(job.id).catch(err => this.emit('error', err));

    this.currentJobs++;
    job.start();
    this.activeJobs.set(job.id, job);
    this.emit('started', job);

    let timeoutHandle;
    if (job.timeout > 0) {
      timeoutHandle = setTimeout(() => {
        const err = new Error(`Job ${job.id} timed out after ${job.timeout}ms`);
        this._handleJobFailure(job, err);
      }, job.timeout);
    }

    Promise.resolve()
      .then(() => job.task())
      .then(result => {
        if (job.status !== 'failed') {
          clearTimeout(timeoutHandle);
          job.complete(result);
          this.activeJobs.delete(job.id);
          this.currentJobs--;
          this._logComplete(job.id, result).catch(err => this.emit('error', err));
          this.emit('completed', job, result);
          this._processNext();
        }
      })
      .catch(err => {
        clearTimeout(timeoutHandle);
        this._handleJobFailure(job, err);
      });
  }

  _handleJobFailure(job, error) {
    job.fail(error);
    this.activeJobs.delete(job.id);
    this.currentJobs--;

    const willRetry = job.shouldRetry();
    this._logFail(job.id, error, willRetry).catch(err => this.emit('error', err));

    if (willRetry) {
      job.prepareForRetry();
      const delay = job.nextRetryDelay();
      this.delayedJobQueue.schedule(job, delay);
      this.emit('retry', job, error);
    } else {
      this.emit('failed', job, error);
    }
    this._processNext();
  }

  async close() {
    while (!this.priorityQueue.isEmpty() || !this.delayedJobQueue.isEmpty()) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Write final checkpoint before closing
    await this._checkpoint();
    this.logStream.end();
  }
}

export default LoggedJobQueue;