import {index, route, type RouteConfig} from '@react-router/dev/routes';
/** Original launcher document addresses only. Assets and Runtime URLs are not
 * application fallbacks and must retain the existing publication routing. */
export default [
  index('routes/surface.tsx', {id: 'library'}),
  route('index.html', 'routes/surface.tsx', {id: 'library-html'}),
  route('en.html', 'routes/surface.tsx', {id: 'library-en'}),
  route('lobby.html', 'routes/surface.tsx', {id: 'directory-html'}),
  route('lobby', 'routes/surface.tsx', {id: 'directory'}),
] satisfies RouteConfig;
