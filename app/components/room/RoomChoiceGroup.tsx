import type {ReactNode} from 'react';

export interface RoomChoice<Value extends string | number> {
  value: Value;
  label: ReactNode;
  selected: boolean;
  disabled: boolean;
  hidden?: boolean;
}
export interface RoomChoiceGroupProps<Value extends string | number> {
  title: ReactNode;
  name?: string;
  valueAttribute: `data-${string}`;
  choices: readonly RoomChoice<Value>[];
  onSelect(value: Value): void;
}
/** Shared room choices; supported values and phase/owner gates remain caller policy. */
export function RoomChoiceGroup<Value extends string | number>({title, name, valueAttribute, choices, onSelect}: RoomChoiceGroupProps<Value>) {
  return <><div className="mp-room-setting-title">{title}</div><div className="mp-room-choice-group" data-mp-room-choice={name}>
    {choices.map(choice => <button key={choice.value} type="button" {...{[valueAttribute]: choice.value}} hidden={choice.hidden} className={choice.selected ? 'selected' : undefined}
      aria-pressed={choice.selected} disabled={choice.disabled} onClick={() => onSelect(choice.value)}>{choice.label}</button>)}
  </div></>;
}
