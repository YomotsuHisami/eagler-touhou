import {index, layout, route, type RouteConfig} from '@react-router/dev/routes';
export default [
  layout('routes/library.tsx', [index('routes/library-index.tsx'), route('play/:productId', 'routes/game.tsx', [
    index('routes/game-settings.tsx'),
    route('resources', 'routes/game-resources.tsx'),
    route('replays', 'routes/game-replays.tsx'),
    route('saves', 'routes/game-saves.tsx'),
  ])]),
  route('lobby', 'routes/lobby.tsx'),
  ...['index.html', 'en.html', 'lobby.html'].map(path => route(path, 'routes/legacy-entry.tsx', {id: `legacy-${path}`})),
] satisfies RouteConfig;
