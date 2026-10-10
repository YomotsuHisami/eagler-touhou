import type {ReactNode} from 'react';

export interface LobbyDialogHeaderProps {
  titleId: string;
  title: ReactNode;
  closeId: string;
  closeLabel?: string;
  closeContent: ReactNode;
  onCloseRequest(): void;
}
/** Shared directory header presentation. Its carrier owns all close semantics. */
export function LobbyDialogHeader({titleId, title, closeId, closeLabel, closeContent, onCloseRequest}: LobbyDialogHeaderProps) {
  return <div className="lobby-dialog-head"><h2 id={titleId}>{title}</h2><button className="lobby-close" id={closeId} type="button" aria-label={closeLabel} onClick={onCloseRequest}>{closeContent}</button></div>;
}
