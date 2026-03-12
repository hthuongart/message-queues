class Job {
  constructor(task, {
    id = Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    priority = 5,           // lower number = higher priority
    maxRetries = 0,
    timeout = 0,            // 0 = no timeout
    createdAt = new Date(),
  } = {}) {
    this.id = id;
    this.task = task;               // function returning a promise
    this.priority = priority;
    this.maxRetries = maxRetries;
    this.retriesLeft = maxRetries;
    this.timeout = timeout;
    this.createdAt = createdAt;
    this.updatedAt = createdAt;
    this.status = 'pending';        // pending, active, completed, failed
    this.result = null;
    this.error = null;
  }

  // Mark job as started
  start() {
    this.status = 'active';
    this.updatedAt = new Date();
  }

  // Mark as completed
  complete(result) {
    this.status = 'completed';
    this.result = result;
    this.updatedAt = new Date();
  }

  // Mark as failed
  fail(error) {
    this.status = 'failed';
    this.error = error;
    this.updatedAt = new Date();
  }

  // Check if we should retry
  shouldRetry() {
    return this.retriesLeft > 0;
  }

  // Prepare for retry (decrement counter, reset status)
  prepareForRetry() {
    this.retriesLeft--;
    this.status = 'pending';
    this.updatedAt = new Date();
  }
}

export default Job;