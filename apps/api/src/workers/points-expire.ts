import { Worker, Queue } from "bullmq"
import { Redis } from "ioredis"
import { expirePoints } from "../lib/points"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null })

export const pointsExpireQueue = new Queue("points-expire", { connection })

export const pointsExpireWorker = new Worker("points-expire", async (job) => {
  if (job.name === "expire") {
    const now = new Date()
    const result = await expirePoints(now)
    console.log(
      `[points-expire] expired ${result.rows} ledger row(s), total ${result.total} point(s) at ${now.toISOString()}`,
    )
    return result
  }
}, { connection })
