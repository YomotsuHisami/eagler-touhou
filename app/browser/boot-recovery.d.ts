export {};
declare global {
  interface Window {
    /** Initial document only; neither navigation nor Runtime resets this owner. */
    __eaglerUiBoot?: {ready(): void; handled(): void};
  }
}
