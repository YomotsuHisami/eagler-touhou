import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

export default [layout('routes/library.tsx', [
  index('routes/home.tsx'),
  route('settings', 'routes/settings.tsx'),
  route('en.html', 'routes/settings.tsx', { id: 'routes/english-alias' }),
  route('lobby.html', 'routes/settings.tsx', { id: 'routes/lobby-alias' }),
  route('index.html', 'routes/settings.tsx', { id: 'routes/index-alias' }),
  route('components', 'routes/components.tsx'),
  route('games/:productId', 'routes/game.tsx', [
    route('resources', 'routes/resources.tsx'),
    route('replays', 'routes/replays.tsx'),
    route('help', 'routes/help.tsx'),
  ]),
  route('lobby', 'routes/lobby.tsx'),
  route('rooms/:roomId', 'routes/room.tsx'),
])] satisfies RouteConfig;
