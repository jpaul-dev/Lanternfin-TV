/** Text-only SRT/WebVTT presentation. Never interpret markup or load linked resources. */
export function plainCaptionText(value: string): string {
  // Unknown tags remain literal. Decode entities after stripping known formatting,
  // so encoded angle brackets cannot turn into active markup.
  return value.replace(/<\/?(?:b|i|u|ruby|rt|font|c(?:\.[\w-]+)*|v|lang)(?:[ \t][^<>\n]{0,200})?>|<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/gi, '')
    .replace(/&(amp|lt|gt|nbsp|lrm|rlm|quot|apos);/g, (_, key: string) => ({ amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f', quot: '"', apos: "'" })[key]!)
    .trim()
}
