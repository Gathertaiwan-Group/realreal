import { createClient } from "@/lib/supabase/client"

const BUCKET = "product-images"

export async function uploadImage(file: File, folder = "editor-uploads"): Promise<string> {
  const supabase = createClient()
  const yyyymm = new Date().toISOString().slice(0, 7).replace("-", "/")
  const ext = file.name.split(".").pop() ?? "bin"
  const path = `${folder}/${yyyymm}/${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
  })
  if (error) throw new Error(`上傳失敗：${error.message}`)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
