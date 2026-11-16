export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return }
  } catch { /* Try the local selection fallback when clipboard permission is unavailable. */ }
  const previous = document.activeElement
  const input = document.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  document.body.append(input)
  try {
    input.select()
    if (!document.execCommand('copy')) throw new Error('Не удалось скопировать. Откройте текст письма и скопируйте его вручную.')
  } finally {
    input.remove()
    if (previous instanceof HTMLElement) previous.focus()
  }
}
