import {renderToReadableStream} from 'react-dom/server';
import {ServerRouter, type EntryContext} from 'react-router';
/** Build-time SPA document only. This project does not deploy a Node server. */
export default async function handleRequest(request: Request, status: number, headers: Headers, context: EntryContext) {
  const body = await renderToReadableStream(<ServerRouter context={context} url={request.url}/>, {signal: request.signal});
  await body.allReady;
  headers.set('Content-Type', 'text/html');
  return new Response(body, {status, headers});
}
