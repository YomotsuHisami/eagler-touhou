import {Navigate, useLocation, useParams} from 'react-router';
import {productManagementSearch} from '../runtime/route-session.mts';
/** Retire the migration's extra resource manager; main imports from settings. */
export default function GameResourcesRoute() {
  const {productId = ''} = useParams(), location = useLocation();
  return <Navigate replace to={{pathname: `/play/${productId}`, search: productManagementSearch(location.search), hash: location.hash}} state={location.state}/>;
}
