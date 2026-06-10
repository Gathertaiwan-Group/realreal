import { Queue } from "bullmq"
import { Redis } from "ioredis"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
})
connection.on("error", (err) => {
  console.error("[queue] Redis connection error (non-fatal):", err.message)
})

export const inventoryQueue = new Queue("inventory", { connection })
