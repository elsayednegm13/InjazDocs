/**
 * The one sentence every surface prints about errors set aside rather than
 * counted as crashes: this kit's panel, the dashboard's crash-free tile and the
 * reading the developer's assistant receives. The server keeps a copy
 * (artifacts/api-server/src/lib/crashSetAside.ts) and a test holds the two
 * function bodies byte-identical, so the three surfaces cannot drift apart.
 * "0" is printed out loud: nothing set aside is a reading, not a blank.
 */
export function setAsideSentence(extension: number, notice: number): string {
  return `set aside, not counted as crashes: ${extension} from browser extensions, ${notice} browser ResizeObserver ${notice === 1 ? "notice" : "notices"}`;
}
