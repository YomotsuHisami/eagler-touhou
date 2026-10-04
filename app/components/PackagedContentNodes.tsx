import {createElement, type ReactNode} from 'react';
import type {PackagedContentNode} from '../services/notices.client';
/** Render only the shared content service's already allowlisted nodes. */
export function renderPackagedNodes(nodes: ReadonlyArray<PackagedContentNode>, prefix = ''): ReactNode[] {
  return nodes.map((node, index) => node.kind === 'text' ? node.text : createElement(node.tag, {key: `${prefix}${index}`, ...node.attributes},
    ...renderPackagedNodes(node.children, `${prefix}${index}.`)));
}
