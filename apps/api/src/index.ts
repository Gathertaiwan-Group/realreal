import "./sentry"
import pino from "pino"
import { app } from "./app"

const logger = pino({
  transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
})

const PORT = Number(process.env.PORT ?? 4000)
app.listen(PORT, () => logger.info({ port: PORT }, "API server started"))
