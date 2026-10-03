import { Component, createRef, useLayoutEffect, type ReactNode } from 'react';
import { motion, useAnimationControls } from 'motion/react';
import styles from './route-transition.module.css';
import { useUiReducedMotion } from '../services/ui-preferences';

export interface RouteTransitionProps { routeKey: string; children: ReactNode; className?: string }
interface Snapshot { key: string; node: HTMLDivElement; width: number; height: number }
interface TransitionProps extends RouteTransitionProps { reduced: boolean; controls: ReturnType<typeof useAnimationControls> }
interface TransitionState { snapshot: Snapshot | null }

/** A stable live outlet plus one inert visual snapshot; never a second live route. */
export function RouteTransition(props: RouteTransitionProps) {
  const reduced = useUiReducedMotion();
  const controls = useAnimationControls();
  useLayoutEffect(() => {
    controls.stop();
    controls.set({ opacity: reduced ? 1 : .55, y: reduced ? 0 : 10 });
    void controls.start({ opacity: 1, y: 0, transition: { duration: reduced ? 0 : .22, ease: [.22, .8, .22, 1] } });
    return () => controls.stop();
  }, [props.routeKey, reduced, controls]);
  return <TransitionOutlet {...props} reduced={reduced} controls={controls} />;
}

class TransitionOutlet extends Component<TransitionProps, TransitionState, Snapshot | null> {
  state: TransitionState = { snapshot: null };
  private readonly live = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(previous: TransitionProps): Snapshot | null {
    const live = this.live.current;
    if (previous.routeKey === this.props.routeKey || !live || this.props.reduced) return null;
    const rect = live.getBoundingClientRect();
    const node = live.cloneNode(true) as HTMLDivElement;
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
    // Media/Runtime elements must never be duplicated by presentation ownership.
    node.querySelectorAll('iframe, script, audio, video, object, embed').forEach(element => element.remove());
    for (const element of [node, ...node.querySelectorAll('*')]) {
      element.removeAttribute('id');
      element.removeAttribute('data-ui-dialog-live');
      for (const attribute of [...element.attributes]) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      }
    }
    return { key: this.props.routeKey, node, width: rect.width, height: rect.height };
  }

  componentDidUpdate(previous: TransitionProps, _state: TransitionState, snapshot: Snapshot | null) {
    if (previous.routeKey !== this.props.routeKey) this.setState({ snapshot });
  }

  render() {
    const snapshot = this.state.snapshot;
    return <div className={`${styles.viewport} ${this.props.className ?? ''}`}>
      <motion.div ref={this.live} className={styles.live} animate={this.props.controls}>{this.props.children}</motion.div>
      {snapshot && <motion.div key={snapshot.key} className={styles.snapshot} inert aria-hidden="true"
        style={{ width: snapshot.width, height: snapshot.height }}
        initial={{ opacity: .7, y: 0 }} animate={{ opacity: 0, y: -8 }}
        transition={{ duration: this.props.reduced ? 0 : .18, ease: 'easeOut' }}
        onAnimationComplete={() => {
          // Completion is presentation-only, and cannot clear a newer snapshot.
          this.setState(state => state.snapshot === snapshot ? { snapshot: null } : null);
        }}>
        <div ref={host => { if (host && snapshot.node.parentNode !== host) host.replaceChildren(snapshot.node); }} />
      </motion.div>}
    </div>;
  }
}
