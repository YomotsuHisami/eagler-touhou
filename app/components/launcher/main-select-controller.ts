import {createCustomSelectController} from '../../../src/launcher/custom-select.mts';
import type {Translate} from '../../i18n';

/** Main and React share one interaction/geometry owner. React supplies its own
 * markup; the default presentation remains available for legacy callers. */
export function createMainSelectController(options: {
  getHost?: (select?: HTMLSelectElement) => HTMLElement;
  translate: Translate;
}) {
  return createCustomSelectController({...options, syncOwner(select, menu) {
    // A detached menu retains its native select's document scope independently
    // from its current body/dialog/fullscreen host.
    menu.toggleAttribute('data-launcher-document', !!select.closest('[data-launcher-document]'));
  }});
}
