# Spec G — TipTap 編輯器升級：上傳圖 + 字級 + 顏色

**Date:** 2026-05-30
**Status:** Draft → pending user review (3 of 3 in E/F/G batch)
**Touches:** apps/web (1 shared component重大改寫 + 1 new helper), apps/api (0 — uses existing Supabase Storage), packages/db (0 migrations)
**Scope:** small-medium — ~350 LOC

## Why

`apps/web/src/components/editor/TiptapEditor.tsx` 是共用編輯器 — 商品摘要/描述、文章內容、site_contents 等多處用。但工具列功能殘廢：
- **圖片**：點 button 跳 browser 原生 `prompt()` 問 URL — 對 admin 是地獄級體驗（要去別處上傳、複製 URL、貼回來）
- **無字體大小 / 文字顏色 / 螢光筆 / 對齊** — 文章排版乾巴巴

升級後文章 + 商品內容都同時受惠。

## Locked decisions
- 圖片上傳走既有 Supabase Storage（沿用 `ProductImageUpload` 用的 bucket / pattern）
- 工具列加 4 個新組：字級 dropdown / 文字顏色 (8 色 preset + 自訂) / 螢光筆 (4 色) / 對齊 (左中右)
- TipTap 擴充用官方套件：`@tiptap/extension-text-style`, `@tiptap/extension-color`, `@tiptap/extension-highlight`, `@tiptap/extension-text-align`，外加自寫 FontSize mark
- 不裝 collaborative editing / version history（OUT）

## Scope

### IN
1. 圖片 button 改：點 → 跳 `<input type="file" accept="image/*">` 檔案選擇器 → 上傳到 Supabase Storage `editor-uploads/<yyyy-mm>/<uuid>.<ext>` → 拿 public URL → insert into editor
2. 字體大小 dropdown：12 / 14 / 16 (default) / 18 / 20 / 24 / 32 px
3. 文字顏色：8 色 preset (#000 / #10305a 品牌藍 / #687279 灰 / #d44 紅 / #e60 橘 / #4a8 綠 / #4b8 藍 / #a4d 紫) + 「自訂」開 native colorpicker
4. 螢光筆 highlight：4 色 preset (黃 / 綠 / 藍 / 粉) + 「無」清除
5. 對齊：左 / 中 / 右 (text-align)
6. 安裝 4 個 npm packages：`@tiptap/extension-text-style @tiptap/extension-color @tiptap/extension-highlight @tiptap/extension-text-align`
7. 新 helper `apps/web/src/components/editor/uploadImage.ts` — 純函式上傳到 Supabase Storage、回傳 public URL

### OUT
- Embed 影片 / iframe
- Code block syntax highlighting
- Mention (@user) / hashtag
- 表格內建 (TipTap 表格較複雜，現有 RichContent 可顯示但不需編輯器內建)
- Drag-drop 圖片上傳（v1 點按鈕上傳；drag-drop 是 nice-to-have）
- Markdown 匯入匯出
- Version history / undo branch

## Design

### Section 1 — uploadImage helper

`apps/web/src/components/editor/uploadImage.ts`:
```ts
import { createClient } from "@/lib/supabase/client"

export async function uploadImage(file: File): Promise<string> {
  const supabase = createClient()
  const yyyymm = new Date().toISOString().slice(0, 7).replace("-", "/")
  const ext = file.name.split(".").pop() ?? "bin"
  const path = `editor-uploads/${yyyymm}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from("images").upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
  })
  if (error) throw new Error(`上傳失敗：${error.message}`)
  const { data } = supabase.storage.from("images").getPublicUrl(path)
  return data.publicUrl
}
```

Bucket 名稱 `images` 需確認既有 — grep `ProductImageUpload` 找出 bucket name；若不同 (例如 product-images) 沿用同一 bucket 但分 sub-folder `editor-uploads/`。

### Section 2 — TiptapEditor 加擴充

`apps/web/src/components/editor/TiptapEditor.tsx`：

```ts
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
import TextStyle from "@tiptap/extension-text-style"
import Color from "@tiptap/extension-color"
import Highlight from "@tiptap/extension-highlight"
import TextAlign from "@tiptap/extension-text-align"
import { Extension } from "@tiptap/core"

// Custom FontSize mark via TextStyle
const FontSize = Extension.create({
  name: "fontSize",
  addOptions() { return { types: ["textStyle"] } },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => el.style.fontSize?.replace(/['"]+/g, ""),
          renderHTML: (attr) => attr.fontSize ? { style: `font-size: ${attr.fontSize}` } : {},
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }) =>
        chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) =>
        chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    } as any
  },
})

const editor = useEditor({
  extensions: [
    StarterKit,
    Image.configure({ inline: false }),
    Link.configure({ openOnClick: false }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    FontSize,
  ],
  content,
  onUpdate: ({ editor }) => onChange(editor.getHTML()),
})
```

### Section 3 — 工具列 UI

`Toolbar` component (in TiptapEditor) — 既有 button group 加：

```tsx
{/* Existing: B / I / S / H2 / H3 / H4 / list / orderedList / quote / hr / inlineCode / codeBlock / link / image / undo / redo */}

{/* NEW: Font size dropdown */}
<select onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}>
  <option value="">字級</option>
  {["12px", "14px", "16px", "18px", "20px", "24px", "32px"].map(s => 
    <option key={s} value={s}>{s.replace("px", "")}</option>)}
</select>

{/* NEW: Text color picker */}
<ColorPicker
  presets={["#000000", "#10305a", "#687279", "#dd4444", "#ee6600", "#44aa88", "#4488bb", "#aa44dd"]}
  onChange={(c) => editor.chain().focus().setColor(c).run()}
  onClear={() => editor.chain().focus().unsetColor().run()}
/>

{/* NEW: Highlight picker */}
<HighlightPicker
  presets={["#fef08a" /*yellow*/, "#bbf7d0" /*green*/, "#bfdbfe" /*blue*/, "#fbcfe8" /*pink*/]}
  onChange={(c) => editor.chain().focus().toggleHighlight({ color: c }).run()}
  onClear={() => editor.chain().focus().unsetHighlight().run()}
/>

{/* NEW: Text align */}
<button onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft /></button>
<button onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter /></button>
<button onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight /></button>

{/* MODIFY: image button replaces prompt() with file picker */}
<button onClick={() => fileInputRef.current?.click()}>
  <ImageIcon />
</button>
<input
  ref={fileInputRef}
  type="file"
  accept="image/*"
  className="hidden"
  onChange={async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const url = await uploadImage(file)
      editor.chain().focus().setImage({ src: url, alt: file.name }).run()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上傳失敗")
    } finally {
      e.target.value = "" // reset for re-upload same file
    }
  }}
/>
```

`ColorPicker` + `HighlightPicker` local sub-components (small popovers).

### Section 4 — 安裝套件

```bash
cd apps/web && npm i @tiptap/extension-text-style @tiptap/extension-color @tiptap/extension-highlight @tiptap/extension-text-align
```

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `apps/web/src/components/editor/uploadImage.ts` |
| 改 | `apps/web/src/components/editor/TiptapEditor.tsx` (大改：加 4 擴充 + 工具列重組 + 圖片上傳替代 prompt) |
| 改 | `apps/web/package.json` (4 deps) |
| 新 (optional) | `apps/web/src/components/editor/ColorPicker.tsx`, `HighlightPicker.tsx` 子元件 (或 inline) |

預估 ~350 LOC 新增 / ~80 LOC 修改 / 0 migration

## Validation

1. `next build` 綠（含新 deps 安裝後）
2. 進 /admin/posts/[id] 編輯文章內容：
   - 點圖片 button → 跳檔案選擇器 → 選 jpg 上傳 → 圖片出現在編輯區
   - 字級 dropdown 改 24px → 該字真的變大
   - 文字色 colorpicker 選紅 → 字真的變紅
   - 螢光筆黃 → 文字背景變黃
   - 對齊置中 → 段落置中
3. 切到 /admin/products/[id] 編輯商品摘要 — 同樣的新工具列出現（共用元件）
4. 儲存後刷新，HTML 內容 + 樣式正確還原（檢查 DB 內 description 欄存的是 inline style，e.g. `<span style="color:#dd4444">紅字</span>`）

## Known caveats

- 圖片上傳到 Supabase Storage `editor-uploads/yyyy/mm/<uuid>.<ext>`，永久公開 URL；沒做圖片壓縮 / 重新編碼。大圖可能放大原始檔。
- ColorPicker / HighlightPicker 用 native `<input type="color">` 或簡單 button grid；不裝 react-color 庫。
- TipTap inline style (`<span style="color:#xxx">`) 在前台 render 時須允許 inline style 通過 sanitizer。grep RichContent component；若有 HTML 過濾，加白名單。
- Drag-drop 上傳是 v2 nice-to-have。
- Bucket policy 若有限制，須確認 Supabase Storage `images` bucket allow public read。
