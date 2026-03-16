import DeadLetterQueue from './DeadLetterQueue.js';
import AdvancedJobQueue from './AdvancedJobQueue.js';

// Create a dead letter queue that persists to a log file
const dlq = new DeadLetterQueue({ logPath: './logs/deadletter.log' });

// Pass it to the job queue
const queue = new AdvancedJobQueue({
  concurrency: 2,
  logPath: './logs/queue.log',
  deadLetterQueue: dlq,
  timeoutCheckIntervalMs: 200 // check every 200ms
});

queue.on('enqueued', job => console.log(`Enqueued job ${job.id} (priority ${job.priority})`));
queue.on('started', job => console.log(`Started job ${job.id}`));
queue.on('completed', (job, result) => console.log(`Job ${job.id} completed: ${result}`));
queue.on('failed', (job, err) => console.log(`Job ${job.id} failed permanently: ${err.message}`));
queue.on('retry', (job, err) => console.log(`Job ${job.id} failed (${err.message}), retrying (${job.retriesLeft} left)`));
queue.on('error', err => console.error('Queue error:', err));

// Add jobs with various options
queue.enqueue(
  () => new Promise(resolve => setTimeout(() => resolve('Quick task'), 300)),
  { priority: 1 } // high priority
);

queue.enqueue(
  () => new Promise((resolve, reject) => setTimeout(() => reject(new Error('Oops')), 200)),
  { priority: 2, maxRetries: 2 }
);

queue.enqueue(
  () => new Promise(resolve => setTimeout(() => resolve('Slow but important'), 2000)),
  { priority: 1, timeout: 1000 } // will time out
);

queue.enqueue(
  () => new Promise(resolve => setTimeout(() => resolve('Background job'), 500)),
  { priority: 10 } // low priority
);

// After some time, close gracefully
setTimeout(async () => {
  await queue.close();
  await dlq.close(); // close the DLQ stream
  // console.log('Dead letters:', dlq.getAll());
  process.exit(0);
}, 5000);