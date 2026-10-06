// Small DOM fixture for content-controller lifecycle tests. Browser parsing and
// executable-markup safety are verified by the explicit content browser lane.
import { parseFragment, serialize } from 'parse5';

export class ContentNode {
  constructor(tag = '', type = 1, text = '') {
    this.nodeType = type; this.localName = tag; this.tagName = tag.toUpperCase();
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.childNodes = []; this.attributes = new Map(); this.value = text;
    if (tag === 'template') this.content = new ContentNode('', 11);
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get textContent() { return this.nodeType === 3 ? this.value : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.childNodes = [new ContentNode('', 3, String(value))]; }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get title() { return this.getAttribute('title') || ''; }
  set title(value) { this.setAttribute('title', value); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(node) { this.childNodes.push(...(node.nodeType === 11 ? node.childNodes : [node])); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  set innerHTML(html) {
    const convert = source => {
      const node = new ContentNode(source.tagName || '', source.nodeName === '#text' ? 3 : source.tagName ? 1 : 11, source.value);
      node.namespaceURI = source.namespaceURI;
      for (const attr of source.attrs || []) node.setAttribute(attr.name, attr.value);
      node.childNodes = (source.childNodes || []).map(convert);
      return node;
    };
    (this.content || this).childNodes = parseFragment(html).childNodes.map(convert);
  }
  get innerHTML() {
    const convert = node => node.nodeType === 3 ? { nodeName: '#text', value: node.value } : ({ nodeName: node.localName,
      tagName: node.localName, namespaceURI: node.namespaceURI, value: node.value,
      attrs: [...node.attributes].map(([name, value]) => ({ name, value })),
      childNodes: node.childNodes.map(convert) });
    return serialize({ nodeName: '#document-fragment', childNodes: this.childNodes.map(convert) });
  }
}

export class ContentDocument {
  baseURI = 'https://launcher.invalid/';
  createElement(tag) { return new ContentNode(tag); }
  createTextNode(text) { return new ContentNode('', 3, text); }
  createDocumentFragment() { return new ContentNode('', 11); }
}
