import { redirect } from "next/navigation"
import { STATIONS } from "./stations"

export default function RecordsIndexPage() {
  redirect(`/idea/records/${STATIONS[0].slug}`)
}
