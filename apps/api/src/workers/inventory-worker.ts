import { Worker } from "bullmq"
import { Redis } from "ioredis"
import { processCreateShipment } from "./logistics-creator"
import { processLowStockAlert } from "../jobs/low-stock-alert"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
})

// Single consumer for the "inventory" queue. BullMQ delivers each job to
// exactly one worker, so the previous design (multiple Workers on the same
// queue each filtering by job.name) silently dropped jobs picked up by the
// "wrong" worker. Dispatch by job name here instead.
export const inventoryWorker = new Worker(
  "inventory",
  async (job) => {
    switch (job.name) {
      case "create-shipment":
        return processCreateShipment((job.data as { orderId: string }).orderId)
      case "low-stock-check":
        return processLowStockAlert()
      default:
        console.warn(`[inventory-worker] unknown job name "${job.name}", skipping`)
        return
    }
  },
  { connection },
)
