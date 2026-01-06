import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractDigits(value: string | null | undefined) {
  if (!value) return ""
  return value.replace(/\D/g, "")
}

export function displayNumericCode(value: string | null | undefined) {
  if (value == null) return ""
  const trimmed = String(value).trim()
  if (!trimmed) return ""
  const digits = extractDigits(trimmed)
  return digits || trimmed
}
