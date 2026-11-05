# ICAL.js

- Version: 2.2.1 (pinned; no runtime CDN requests)
- Upstream: https://github.com/kewisch/ical.js
- Distribution: https://registry.npmjs.org/ical.js/-/ical.js-2.2.1.tgz
- Local `ical.cjs` is the **unmodified**, unminified `dist/ical.es5.cjs` from that package.
- SHA-256: `02b0ab420c2b3af5bd0829b12b8becdffdc2311e62070c381cc0c60b52b0b365`
- License: Mozilla Public License 2.0; see `ical-LICENSE.txt`.

The readable source and license are included in the Mac app as well as the repository.
`src/import/ics-import.ts` supplies the app-specific import policy and a per-import IANA timezone fallback using the device's Intl database. Embedded VTIMEZONE definitions take precedence. No global timezone registry is modified.

The file extension is `.cjs` so Node treats the unchanged upstream distribution as CommonJS inside this ES module project. Browser builds bundle it into `build/app.js`.
