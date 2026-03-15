import PriorityQueue from './PriorityQueue.js';

class DelayedJobQueue {
  constructor(mainQueue) {
    this.delayedJobs = new PriorityQueue((a, b) => a.dueTime - b.dueTime); // min-heap by dueTime
    this.timer = null;
    this.mainQueue = mainQueue;
  }

  schedule(job, delay) {
    const dueTime = Date.now() + delay;
    job.dueTime = dueTime;
    this.delayedJobs.enqueue(job);
    this._scheduleWakeUp();
  }

  _scheduleWakeUp() {
    if (this.timer) clearTimeout(this.timer);
    if (this.delayedJobs.isEmpty()) return;

    const nextJob = this.delayedJobs.peek();
    const wait = Math.max(0, nextJob.dueTime - Date.now());

    this.timer = setTimeout(() => {
      this._processDueJobs();
    }, wait);
  }

  _processDueJobs() {
    const now = Date.now();
    while (!this.delayedJobs.isEmpty() && this.delayedJobs.peek().dueTime <= now) {
      const job = this.delayedJobs.dequeue();
      this.mainQueue.enqueue(job.task, {
        id: job.id,
        priority: job.priority,
        maxRetries: job.maxRetries,
        retriesLeft: job.retriesLeft,
        timeout: job.timeout,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        status: job.status
      });   // move to main queue
    }
    this._scheduleWakeUp(); // schedule next wake-up
  }

  isEmpty() {
    const isEmptyQueue = this.delayedJobs.isEmpty();
    return isEmptyQueue;
  }
}

export default DelayedJobQueue;