import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import Job from './Job.js';
import PriorityQueue from './PriorityQueue.js';

class AdvancedJobQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.concurrency = options.concurrency || 1;
    this.priorityQueue = new PriorityQueue();
    this.activeJobs = new Map();      // id -> job that is currently running
    this.currentJobs = 0;
    this.persistPath = options.persistPath; // if provided, enable persistence
    this.persistDebounce = null;

    if (this.persistPath) {
      this._loadFromDisk().then(() => {
        this.emit('loaded');
        this._processNext(); // start processing after load
      }).catch(err => {
        this.emit('error', err);
      });
    }
  }

  // Producer: add a job to the queue
  enqueue(task, options = {}) {
    const job = new Job(task, options);
    this.priorityQueue.enqueue(job);
    this.emit('enqueued', job);
    this._persist();
    this._processNext();
    return job.id;
  }

  // Internal: try to start a new job if concurrency allows
  _processNext() {
    if (this.currentJobs >= this.concurrency) return;

    const job = this.priorityQueue.dequeue();
    if (!job) return;

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
        if (job.status !== 'failed') { // might have been failed by timeout
          clearTimeout(timeoutHandle);
          job.complete(result);
          this.activeJobs.delete(job.id);
          this.currentJobs--;
          this.emit('completed', job, result);
          this._persist();
          this._processNext(); // process next job
        }
      })
      .catch(err => {
        clearTimeout(timeoutHandle);
        this._handleJobFailure(job, err);
      });
  }

  // Handle job failure (including retries)
  _handleJobFailure(job, error) {
    job.fail(error);
    this.activeJobs.delete(job.id);
    this.currentJobs--;

    if (job.shouldRetry()) {
      job.prepareForRetry();
      this.priorityQueue.enqueue(job);
      this.emit('retry', job, error);
    } else {
      this.emit('failed', job, error);
    }

    this._persist();
    this._processNext(); // continue with next job
  }

  // Persistence methods
  async _persist() {
    if (!this.persistPath) return;

    // Debounce writes to avoid too many disk I/O operations
    if (this.persistDebounce) clearTimeout(this.persistDebounce);
    this.persistDebounce = setTimeout(() => this._saveToDisk(), 200);
  }

  async _saveToDisk() {
    try {
      const data = {
        jobs: this.priorityQueue.toArray(),
        activeJobs: Array.from(this.activeJobs.values()),
        currentJobs: this.currentJobs,
        // We don't store concurrency etc., they come from constructor
      };
      await fs.writeFile(this.persistPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      this.emit('error', err);
    }
  }

  async _loadFromDisk() {
    try {
      const content = await fs.readFile(this.persistPath, 'utf8');
      const data = JSON.parse(content);
      // Recreate jobs from plain objects
      const jobs = data.jobs.map(j => Object.assign(new Job(() => {}), j));
      this.priorityQueue = PriorityQueue.fromArray(jobs);
      // Restore active jobs? In a real system you'd probably re-enqueue them.
      // For simplicity, we'll re-enqueue any active or pending jobs that are not completed/failed.
      // But here we just put everything back into the queue.
      // We'll also reset status of 'active' to 'pending' because they were interrupted.
      const allJobs = jobs.concat(data.activeJobs.map(j => Object.assign(new Job(() => {}), j)));
      allJobs.forEach(j => {
        if (j.status === 'active' || j.status === 'pending') {
          j.status = 'pending';
          this.priorityQueue.enqueue(j);
        }
        // completed/failed jobs are not re-enqueued
      });
      this.currentJobs = 0; // reset
      this.emit('loaded');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; // ignore missing file
    }
  }

  // Utility: get queue size
  size() {
    return this.priorityQueue.size() + this.activeJobs.size;
  }

  // Graceful shutdown: wait for active jobs to finish?
  async close() {
    // Wait for active jobs to complete (optional)
    while (this.activeJobs.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Final persist
    if (this.persistPath) {
      await this._saveToDisk();
    }
  }
}

export default AdvancedJobQueue;