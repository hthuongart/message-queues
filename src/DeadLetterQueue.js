import fs from 'fs';
import Job from './Job.js';

/**
 * DeadLetterQueue - stores permanently failed jobs using an append‑only log.
 */
class DeadLetterQueue {
  /**
   * @param {Object} options
   * @param {string} [options.logPath] - File path for the dead letter log (optional).
   *                                      If omitted, operates in memory only.
   */
  constructor(options = {}) {
    this.logPath = options.logPath;
    this.jobs = []; // each entry: { jobData, error, diedAt }

    if (this.logPath) {
      // Open log in append mode
      this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
      this._recoverFromLog();
    }
  }

  // ---------- Logging ----------
  _appendLog(entry) {
    return new Promise((resolve, reject) => {
      const line = JSON.stringify(entry) + '\n';
      this.logStream.write(line, 'utf8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // Rebuild state by reading the entire log (simple version)
  _recoverFromLog() {
    if (!fs.existsSync(this.logPath)) return;

    const content = fs.readFileSync(this.logPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'deadletter') {
          this.jobs.push({
            jobData: entry.jobData,
            error: entry.error,
            diedAt: entry.diedAt
          });
        }
        // (If we later add checkpoints, handle them here)
      } catch (err) {
        console.error('Invalid dead letter log entry:', line);
      }
    }
  }

  // ---------- Public API ----------
  /**
   * Add a permanently failed job.
   * @param {Job} job - The original job instance.
   * @param {Error} error - The final error.
   */
  async add(job, error) {
    const deadLetter = {
      jobData: this._serializeJob(job),
      error: {
        message: error.message,
        stack: error.stack,
      },
      diedAt: Date.now(),
    };

    this.jobs.push(deadLetter);

    if (this.logPath) {
      await this._appendLog({
        type: 'deadletter',
        ...deadLetter,
      });
    }
  }

  /**
   * Return all dead letters (as plain objects).
   */
  getAll() {
    return this.jobs.slice();
  }

  /**
   * Return dead letters as reconstructed Job instances (with dummy task).
   */
  getAllAsJobs() {
    return this.jobs.map(entry => ({
      job: new Job(() => {}, entry.jobData),
      error: entry.error,
      diedAt: entry.diedAt,
    }));
  }

  /**
   * Clear the dead letter queue (truncates the log if persisted).
   */
  async clear() {
    this.jobs = [];
    if (this.logPath) {
      // Close current stream, delete file, and open a new one
      await new Promise(resolve => this.logStream.end(resolve));
      fs.unlinkSync(this.logPath);
      this.logStream = fs.createWriteStream(this.logPath, { flags: 'a' });
    }
  }

  // ---------- Helpers ----------
  _serializeJob(job) {
    const { task, ...serializable } = job;
    return serializable;
  }

  // Optionally close the stream when shutting down
  async close() {
    if (this.logStream) {
      await new Promise(resolve => this.logStream.end(resolve));
    }
  }
}

export default DeadLetterQueue;