import { extractText, getDocumentProxy } from 'unpdf'

/** Plain text of a PDF, pages merged. Scanned (image-only) PDFs yield an empty string. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(pdf, { mergePages: true })
  return text.replace(/\u0000/g, '').trim()
}
