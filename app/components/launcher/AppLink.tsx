import {Link, useLocation, type LinkProps} from 'react-router';
import {nextPageHistory, pageOf, readPageHistory, PAGE_HISTORY_KEY} from '../../navigation/page-history';

/** Known launcher document links share the Router's fixed page parent records. */
export function AppLink({href, state, replace, ...props}: Omit<LinkProps, 'to'> & {href: string}) {
  const location = useLocation();
  const url = new URL(href, new URL(location.pathname + location.search + location.hash, 'https://launcher.invalid'));
  const record = nextPageHistory(readPageHistory(location.state), pageOf({pathname: url.pathname, search: url.search, hash: url.hash, state}), replace === true);
  return <Link {...props} to={href} replace={replace} state={{...state, [PAGE_HISTORY_KEY]: record}}/>;
}
