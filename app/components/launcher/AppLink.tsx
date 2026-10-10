import {Link, type LinkProps} from 'react-router';

/** Known launcher document addresses only. Preserve the original anchor while
 * handing internal navigation to the one Router/blocker owner. Standalone
 * FAQ/about/migration documents and external destinations remain native links. */
export function AppLink({href, ...props}: Omit<LinkProps, 'to'> & {href: string}) {
  return <Link {...props} to={href}/>;
}
