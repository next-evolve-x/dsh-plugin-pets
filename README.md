# dsh-pets

[中文文档](README.zh-CN.md)

Animated Codex-style pets for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web interface.

The plugin adds a floating pet layer to the DSH web app. Adopt pets from the public [codex-pets.net](https://codexpets.net/) gallery, drag them into place, and let their animation reflect the current session's activity.

## Features

- Renders standard Codex Pet spritesheets with an `8 x 9` cell layout on a pixelated canvas.
- Shows an adopt button until a pet is installed; then displays the active pet as a draggable floating sprite.
- Derives pet mood from the active DSH session:
  - **Idle**: no active agent or live background job.
  - **Working**: the agent is running, or a job is `running` or `stopping`.
  - **Happy**: a live job completes or is killed; shown for five seconds.
  - **Sad**: a live job fails; shown for five seconds.
- Automatically detects occupied animation rows and skips transparent frames. You can preview rows and choose the idle row manually.
- Includes Chinese and English UI, a size control, adopted-pet switching/removal, and gallery search by name, slug, or tag.
- Fetches the public gallery through the DSH server, caching it in memory for 10 minutes and on disk for offline fallback.

## Requirements

- A DSH installation with the web profile available.
- A Node.js version supported by your DSH installation. The plugin itself has no runtime npm dependencies.
- `pnpm` available on `PATH`; DSH delegates plugin installation and removal to it:
  ```sh
  npm install -g pnpm
  ```
- Network access to `codexpets.net` when browsing the gallery or adopting a new pet.

## Install

Install the package into DSH's `web` profile. The commands below use `npx`, so
they work without a globally installed `dsh` executable:

```sh
# Local checkout
npx @deepseek-ai/dsh plugin --profile web add file:/absolute/path/to/dsh-pets

# GitHub repository
npx @deepseek-ai/dsh plugin --profile web add github:next-evolve-x/dsh-plugin-pets

# Or a published package
# npx @deepseek-ai/dsh plugin --profile web add dsh-pets
```

If `dsh` is globally installed, replace `npx @deepseek-ai/dsh` with `dsh`.
The package declares a DSH bundle, so installation automatically adds its host
entry to the web profile. No `cordis.patch.yml` edit is needed.

If you installed an earlier version by manually adding a `dsh-pets` entry to
`~/.dsh/profiles/web/cordis.patch.yml`, remove that legacy entry before
restarting after the upgrade. The bundle now supplies the entry itself.

Restart the web profile:

```sh
npx @deepseek-ai/dsh web
```

Open the DSH web interface. A paw button appears in the lower-right corner before the first adoption. Click it to open the pet shop, choose a pet, and it becomes active immediately.

## Uninstall

Remove the installed package by its package name, not its GitHub spec:

```sh
npx @deepseek-ai/dsh plugin --profile web remove dsh-pets
```

The plugin manager automatically removes the bundle from the profile. Restart
the web profile afterward. Only installations upgraded from an earlier manual
setup need to remove the old `dsh-pets` entry from `cordis.patch.yml`.

For Git, npm, upgrade, and distribution options, see [DISTRIBUTION.md](DISTRIBUTION.md).

## Using The Pet

- **Open the shop:** click the active pet, or the paw button before adopting one.
- **See a pet before adopting:** shop cards show a spritesheet thumbnail (lazy-loaded for
  not-yet-adopted pets; an animated same-origin preview once adopted). Adopting a pet
  activates it immediately in the corner.
- **Adopted list previews:** each adopted pet shows a small animated thumbnail, so you can
  see its look before switching to it.
- **Move it:** drag the active pet. Its right and bottom offsets are saved after the drag ends.
- **Change animation settings:** open the pet menu to adjust scale, preview sprite rows, and set the idle row.
- **Switch or remove:** use the **Adopted** section in the menu. Removing the active pet clears the active selection.
- **Browse the gallery:** search by pet name, slug, or tag. The shop initially shows 60 results and can load more.

## Storage And Configuration

By default, the plugin stores its data in:

```text
$DSH_HOME/storages/pets/
```

If `DSH_HOME` is not set, this resolves to `~/.dsh/storages/pets/`.

```text
pets/
  state.json            # active pet, scale, idle row, and position
  gallery.json          # last successfully fetched gallery response
  <pet-id>/
    pet.json            # manifest from the pet package
    meta.json           # local install metadata
    spritesheet.webp    # downloaded sprite asset
```

The host plugin also accepts an optional `root` configuration value to use another storage directory.

## HTTP API

The host registers same-origin routes on the DSH web server.

| Method | Route | Description |
|---|---|---|
| `GET`, `HEAD` | `/pets/api/state` | Returns persisted settings and installed pet manifests. |
| `POST` | `/pets/api/state` | Merges supported settings: `activeId`, `hidden`, `scale`, `idleRow`, and `position`. Scale is clamped to `0.25`-`6`. |
| `GET`, `HEAD` | `/pets/api/gallery` | Returns gallery items. Add `?refresh=1` to bypass the 10-minute in-memory cache. |
| `POST` | `/pets/api/install` | Downloads and installs a pet. Body: `{ "slug": "pet-slug" }`. The installed pet becomes active. |
| `POST` | `/pets/api/remove` | Removes a cached pet. Body: `{ "id": "pet-id" }`. |
| `GET`, `HEAD` | `/pets/assets/<id>/<file>` | Serves an installed pet asset. |

Request bodies must be JSON and are limited to 1 MiB. Pet IDs, slugs, and asset names are validated, and asset paths are checked to remain inside the configured pets directory.

## Data And Privacy

The browser talks only to the same-origin DSH routes. The DSH host contacts `codexpets.net` only to fetch the gallery and download an adopted pet package. Gallery data and installed assets are stored locally under the pets directory above.

## Development Notes

The package has two halves:

| File | Role |
|---|---|
| `lib/index.js` | DSH host plugin: storage, ZIP extraction, gallery retrieval, and HTTP routes. |
| `lib/client.js` | DSH browser client module: overlay UI, sprite rendering, session-driven moods, and localization. |

The repository includes standalone smoke-test scripts:

```sh
node test-host.mjs
node test-client.mjs
```

`test-host.mjs` expects locally prepared fixture files at `/tmp/agumon.zip` and `/tmp/codexpets_fresh.html`, then also exercises live gallery and installation requests. `test-client.mjs` expects the DSH web profile and its React dependencies to be installed.

## Credits

- Pet packages and the public gallery are provided by [codex-pets.net](https://codexpets.net/).
- Spritesheets follow the [Codex Pet spritesheet guide](https://codex-pet.org/spritesheet-webp/).

## License

MIT
