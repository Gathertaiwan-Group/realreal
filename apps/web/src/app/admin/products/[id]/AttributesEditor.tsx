"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Row = { key: string; value: string }

type AttributesEditorProps = {
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
}

function rowsToRecord(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    // last write wins
    out[k] = r.value
  }
  return out
}

function recordToRows(rec: Record<string, string>): Row[] {
  return Object.entries(rec).map(([key, value]) => ({ key, value }))
}

function recordsEqual(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (a[k] !== b[k]) return false
  }
  return true
}

function AttributesEditor({ value, onChange }: AttributesEditorProps) {
  // Internal state preserves insertion order and allows empty-key rows
  // while user is typing. We seed from `value` once, and only re-seed when
  // an externally-provided value diverges from what our rows would produce
  // (so a parent reset still works, but our own onChange round-trip doesn't
  // wipe in-progress empty rows).
  const [rows, setRows] = React.useState<Row[]>(() => recordToRows(value))
  const lastEmittedRef = React.useRef<Record<string, string>>(value)

  React.useEffect(() => {
    if (!recordsEqual(value, lastEmittedRef.current)) {
      setRows(recordToRows(value))
      lastEmittedRef.current = value
    }
  }, [value])

  const commit = React.useCallback(
    (nextRows: Row[]) => {
      setRows(nextRows)
      const rec = rowsToRecord(nextRows)
      if (!recordsEqual(rec, lastEmittedRef.current)) {
        lastEmittedRef.current = rec
        onChange(rec)
      }
    },
    [onChange],
  )

  const handleKeyChange = (index: number, key: string) => {
    const next = rows.slice()
    next[index] = { ...next[index], key }
    commit(next)
  }

  const handleValueChange = (index: number, val: string) => {
    const next = rows.slice()
    next[index] = { ...next[index], value: val }
    commit(next)
  }

  const handleDelete = (index: number) => {
    const next = rows.slice()
    next.splice(index, 1)
    commit(next)
  }

  const handleAdd = () => {
    commit([...rows, { key: "", value: "" }])
  }

  return (
    <div className="mt-2 rounded-[10px] bg-gray-50 p-3">
      {rows.length === 0 ? (
        <p className="mb-2 text-xs text-gray-400">尚無屬性</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className="h-9 flex-1 text-sm"
                placeholder="屬性名稱（例：口味）"
                value={row.key}
                onChange={(e) => handleKeyChange(index, e.target.value)}
              />
              <Input
                className="h-9 flex-1 text-sm"
                placeholder="屬性值（例：芝麻）"
                value={row.value}
                onChange={(e) => handleValueChange(index, e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(index)}
                aria-label="刪除屬性"
                className="h-9 px-2 text-gray-500 hover:text-red-600"
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAdd}
        className="mt-3"
      >
        + 新增屬性
      </Button>
    </div>
  )
}

export default AttributesEditor
