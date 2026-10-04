// Exact in-memory routes only: acceptance fixtures never map URL paths onto the filesystem.
export function serveOwnedFixture(request, response, { ownedPages, ownedAssets, rootPage }) {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname !== '/' && Object.hasOwn(ownedAssets ?? {}, pathname)) {
    const asset = ownedAssets[pathname];
    response
      .writeHead(200, { 'content-type': asset.contentType, 'cache-control': 'no-store' })
      .end(asset.body);
    return;
  }
  const ownedPage =
    pathname === '/'
      ? null
      : Object.hasOwn(ownedPages ?? {}, pathname)
        ? ownedPages[pathname]
        : null;
  if (pathname !== '/' && !ownedPage) {
    response.writeHead(404).end();
    return;
  }
  response
    .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    .end(ownedPage ?? rootPage);
}
