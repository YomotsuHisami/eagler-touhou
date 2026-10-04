import {index, route, type RouteConfig} from '@react-router/dev/routes';
export default [index('routes/library.tsx'), route('play/:productId', 'routes/game.tsx', [
  index('routes/game-settings.tsx'),
  route('resources', 'routes/game-resources.tsx'),
  route('replays', 'routes/game-replays.tsx'),
])] satisfies RouteConfig;
