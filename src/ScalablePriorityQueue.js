/**
 * ScalablePriorityQueue – buckets jobs by priority.
 * Assumes priority is a non‑negative integer within a known range.
 */

import MinHeap from "./MinHeap.js";

class ScalablePriorityQueue {
  constructor(maxPriority = 1000) {
    this.buckets = Array.from({ length: maxPriority + 1 }, () => []);
    this.activePriorities = new MinHeap();
    this.priorityPresent = new Array(maxPriority + 1).fill(false);
  }

  enqueue(job) {
    const p = job.priority;
    this.buckets[p].push(job);
    if (!this.priorityPresent[p]) {
      this.priorityPresent[p] = true;
      this.activePriorities.insert(p);
    }
  }

  dequeue() {
    if (this.activePriorities.isEmpty()) return null;
    const minP = this.activePriorities.peek();
    const bucket = this.buckets[minP];
    const job = bucket.shift();
    if (bucket.length === 0) {
      this.activePriorities.extractMin();
      this.priorityPresent[minP] = false;
    }
    return job;
  }

  peek() {
    if (this.activePriorities.isEmpty()) return null;
    const minP = this.activePriorities.peek();
    return this.buckets[minP][0] || null;
  }

  isEmpty() {
    return this.activePriorities.isEmpty();
  }

  size() {
    return this.buckets.reduce((acc, bucket) => acc + bucket.length, 0);
  }

  /**
   * Returns a flat array of all jobs (order not guaranteed).
   * Used for persistence (checkpointing).
   */
  toArray() {
    return this.buckets.flat();
  }

  /**
   * Rebuilds a ScalablePriorityQueue from an array of jobs.
   * @param {Job[]} jobs
   * @param {number} maxPriority
   * @returns {ScalablePriorityQueue}
   */
  static fromArray(jobs, maxPriority = 1000) {
    const pq = new ScalablePriorityQueue(maxPriority);
    for (const job of jobs) {
      pq.enqueue(job);
    }
    return pq;
  }
}

export default ScalablePriorityQueue;