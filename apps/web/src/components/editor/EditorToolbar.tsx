"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListOrdered,
  Quote,
  Code,
  Code2,
  Link,
  Image,
  Undo,
  Redo,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Palette,
  Highlighter,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCallback, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { uploadImage } from "./uploadImage";

interface EditorToolbarProps {
  editor: Editor | null;
}

const TEXT_COLOR_PRESETS = [
  "#000000",
  "#10305a",
  "#687279",
  "#dd4444",
  "#ee6600",
  "#44aa88",
  "#4488bb",
  "#aa44dd",
];

const HIGHLIGHT_COLOR_PRESETS = [
  "#fef08a", // yellow
  "#bbf7d0", // green
  "#bfdbfe", // blue
  "#fbcfe8", // pink
];

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "32px"];

function ToolbarDivider() {
  return <div className="mx-1 h-6 w-px bg-gray-200" />;
}

interface ColorPickerProps {
  editor: Editor;
}

function ColorPicker({ editor }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        title="Text Color"
        className="h-8 w-8 rounded-md text-[#687279] hover:bg-gray-100 hover:text-[#687279]"
      >
        <Palette className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute left-0 top-9 z-20 flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-2 shadow-md">
          <div className="grid grid-cols-4 gap-1">
            {TEXT_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  editor.chain().focus().setColor(c).run();
                  setOpen(false);
                }}
                className="h-6 w-6 rounded border border-gray-200 hover:scale-110 transition-transform"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#687279]">自訂</label>
            <input
              type="color"
              onChange={(e) => {
                editor.chain().focus().setColor(e.target.value).run();
              }}
              className="h-6 w-12 cursor-pointer rounded border border-gray-200"
            />
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().unsetColor().run();
                setOpen(false);
              }}
              className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[#687279] hover:bg-gray-100"
              title="Clear color"
            >
              <X className="h-3 w-3" />
              清除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface HighlightPickerProps {
  editor: Editor;
}

function HighlightPicker({ editor }: HighlightPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        title="Highlight"
        className={cn(
          "h-8 w-8 rounded-md",
          editor.isActive("highlight")
            ? "bg-[#10305a] text-white hover:bg-[#10305a] hover:text-white"
            : "text-[#687279] hover:bg-gray-100 hover:text-[#687279]"
        )}
      >
        <Highlighter className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute left-0 top-9 z-20 flex flex-col gap-2 rounded-md border border-gray-200 bg-white p-2 shadow-md">
          <div className="flex gap-1">
            {HIGHLIGHT_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  editor.chain().focus().toggleHighlight({ color: c }).run();
                  setOpen(false);
                }}
                className="h-6 w-6 rounded border border-gray-200 hover:scale-110 transition-transform"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().unsetHighlight().run();
                setOpen(false);
              }}
              className="flex h-6 w-6 items-center justify-center rounded border border-gray-200 text-[#687279] hover:bg-gray-100"
              title="Clear highlight"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  title,
  children,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "h-8 w-8 rounded-md",
        isActive
          ? "bg-[#10305a] text-white hover:bg-[#10305a] hover:text-white"
          : "text-[#687279] hover:bg-gray-100 hover:text-[#687279]"
      )}
    >
      {children}
    </Button>
  );
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter URL", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const handleImageFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!editor) return;
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const url = await uploadImage(file);
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上傳失敗");
      } finally {
        e.target.value = "";
      }
    },
    [editor]
  );

  const handleFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!editor) return;
      const size = e.target.value;
      if (!size) {
        editor.chain().focus().unsetFontSize().run();
        return;
      }
      editor.chain().focus().setFontSize(size).run();
    },
    [editor]
  );

  if (!editor) return null;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-white px-2 py-1.5 rounded-t-lg">
      {/* Inline formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="Bold"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="Italic"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title="Strikethrough"
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        isActive={editor.isActive("heading", { level: 4 })}
        title="Heading 4"
      >
        <Heading4 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive("bulletList")}
        title="Bullet List"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive("orderedList")}
        title="Ordered List"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Block elements */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        isActive={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title="Inline Code"
      >
        <Code className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        isActive={editor.isActive("codeBlock")}
        title="Code Block"
      >
        <Code2 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Link & Image */}
      <ToolbarButton
        onClick={setLink}
        isActive={editor.isActive("link")}
        title="Link"
      >
        <Link className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => fileInputRef.current?.click()}
        title="Image"
      >
        <Image className="h-4 w-4" />
      </ToolbarButton>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileChange}
      />

      <ToolbarDivider />

      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo"
      >
        <Undo className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo"
      >
        <Redo className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Font size */}
      <select
        onChange={handleFontSizeChange}
        value=""
        title="Font Size"
        className="h-8 rounded-md border border-gray-200 bg-white px-1.5 text-xs text-[#10305a] hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#10305a]"
      >
        <option value="">字級</option>
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>
            {s.replace("px", "")}
          </option>
        ))}
      </select>

      {/* Text color */}
      <ColorPicker editor={editor} />

      {/* Highlight */}
      <HighlightPicker editor={editor} />

      <ToolbarDivider />

      {/* Text align */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        isActive={editor.isActive({ textAlign: "left" })}
        title="Align Left"
      >
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        isActive={editor.isActive({ textAlign: "center" })}
        title="Align Center"
      >
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        isActive={editor.isActive({ textAlign: "right" })}
        title="Align Right"
      >
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}
