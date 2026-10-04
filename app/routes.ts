import {index, route, type RouteConfig} from '@react-router/dev/routes';
export default [index('routes/library.tsx'),
  route('lobby', 'routes/lobby.tsx'),
  ...['index.html','en.html','lobby.html'].map(path => route(path, 'routes/legacy-entry.tsx', {id: `legacy-${path}`})), route('play/:productId', 'routes/game.tsx', [
  index('routes/game-settings.tsx'),
  route('resources', 'routes/game-resources.tsx'),
  route('replays', 'routes/game-replays.tsx'),
  route('saves', 'routes/game-saves.tsx'),
])] satisfies RouteConfig;
