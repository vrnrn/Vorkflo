# Vorkflo website

The standalone landing page for **https://vorkflo.vrnrn.com** lives in `site/src/`, alongside the application in this repository. It uses local assets, system fonts, plain HTML/CSS, and a small browser script. The workflow illustration is simulated and never executes commands or connects to an AI service.

From the repository root:

```sh
npm run site:dev       # http://127.0.0.1:4174, rebuilds when site/src/ changes
npm run site:verify    # builds site/dist/ and checks the publication files
```

The website has no npm dependencies and can also be built independently with `npm run verify --prefix site`, without installing or building the desktop application. The repository's `npm run verify` includes the website checks. Generated `site/dist/` is ignored and contains only the product page, assets, crawler metadata, a real 404 page, and Cloudflare response headers.

## Publishing

Cloudflare Pages project **vorkflo-web** connects to **vrnrn/Vorkflo** with:

- Production branch: `main`
- Root directory: `site`
- Build command: `npm run verify`
- Output directory: `dist` (relative to `site`)
- Node.js: 24
- Environment variable: `SKIP_DEPENDENCY_INSTALL=true`
- Custom domain: `vorkflo.vrnrn.com`

Production pushes that change `site/` trigger the Pages build. Local builds and previews do not publish. The domain remains associated with this Pages project; its proxied CNAME points to `vorkflo-web.pages.dev`. Manage the domain through Pages so Cloudflare provisions its association and TLS. The portfolio at `vrnrn.com` and its article-star Worker are maintained separately in [vrnrn/vrnrn.com](https://github.com/vrnrn/vrnrn.com).

The former **vorkflo-site** Pages project is retained with automatic deployments disabled for rollback. It no longer owns the custom domain. Its previous deployment remains available at `vorkflo-site.pages.dev`.

## Content and assets

Product features, requirements, installation details, and license follow this repository. Downloads are pinned to the verified **v0.4.0** DMG. When releasing a new version, update the release badge, both download links, checksum link, version text, and download checks in `site/scripts/check.mjs` together.

The editor screenshot and app icon come from `docs/assets/editor.png` and `apps/desktop/build/icon.png`. The web icon is resized and its EXIF metadata removed; the editor screenshot is unchanged. The MIT license is preserved in `site/src/assets/LICENSE.txt` and included in the build. No remote assets are loaded.

Before publishing, run `npm run site:verify`. It checks assets, anchors, download links, metadata, crawler files, the publication allowlist, and JavaScript syntax. Browser verification should cover the three demo scenarios, replay, switching scenarios while running, keyboard operation, FAQ expansion, a narrow viewport, and reduced motion. Without JavaScript, the static workflow, screenshot, documentation, FAQ, and downloads remain available.
