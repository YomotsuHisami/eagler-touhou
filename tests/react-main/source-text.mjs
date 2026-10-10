/** Git blobs use LF even when the Windows checkout uses CRLF. */
export const normalizeSourceText = value => value.replaceAll('\r\n', '\n');
/** The sole added UI label is covered separately by the shared-settings fixture.
 * All prior messages and domain authorities remain pinned byte for byte. */
export const pinnedUiAuthorityText = value => normalizeSourceText(value).replace(/^  \["settings.thpracMultiplayerDisabled".*\n/m, '');
