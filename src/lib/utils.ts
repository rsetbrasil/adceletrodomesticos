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

export function toBrazilE164(value: string | null | undefined): string | null {
  const digits = extractDigits(value)
  if (!digits) return null
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return `+${digits}`
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`
  if (digits.startsWith("+")) return digits
  return `+${digits}`
}
