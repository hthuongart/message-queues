class Job {
  constructor(task, {
    id = Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    priority = 5,           // lower number = higher priority
    maxRetries = 0,
    retriesLeft = maxRetries,
    retryCount = 0,
    timeout = 0,            // 0 = no timeout
    retryDelay = 1000,        // base delay in ms
    backoffMultiplier = 2,    // multiplier for exponential backoff
    maxRetryDelay = 30000,    // cap delay at 30 seconds
    jitter = true,            // add random jitter
    createdAt = new Date(),
    updatedAt = createdAt,
    status = 'pending',
    result = null,
    error = null,

  } = {}) {
    this.id = id;
    this.task = task;
    this.priority = priority;
    this.maxRetries = maxRetries;
    this.retriesLeft = retriesLeft;
    this.retryCount = retryCount;      // number of retries already performed
    this.retryDelay = retryDelay;
    this.backoffMultiplier = backoffMultiplier;
    this.maxRetryDelay = maxRetryDelay;
    this.jitter = jitter;
    this.timeout = timeout;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.status = status;
    this.result = result;
    this.error = error;
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
  
  // Calculate next retry delay
  nextRetryDelay() {
    let delay = this.retryDelay * Math.pow(this.backoffMultiplier, this.retryCount);
    if (this.maxRetryDelay) delay = Math.min(delay, this.maxRetryDelay);
    if (this.jitter) {
      // Add up to ±10% random jitter
      const jitterFactor = 0.1 * delay * (Math.random() * 2 - 1);
      delay = Math.max(0, delay + jitterFactor);
    }
    return Math.floor(delay);
  }

  prepareForRetry() {
    this.retriesLeft--;
    this.retryCount++;
    this.status = 'pending';
    this.updatedAt = new Date();
  }
}

export default Job;