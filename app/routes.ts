import {index, route, type RouteConfig} from '@react-router/dev/routes';
export default [index('routes/library.tsx'), route('games/:productId', 'routes/game.tsx')] satisfies RouteConfig;
