# Security

The ad-filter capability exposes aggregate counts and an enable switch for the music session only. It uses fixed-source EasyList network rules with no remote scriptlet execution. Account pages and media delivery are excluded. Separate account windows share the persistent session but receive no preload or plugin bridge. Local room relays bind only to loopback. Explicit internet-room startup uses PeerJS and encrypted WebRTC data channels; permanent remote relays require TLS.

Playback ad filtering uses fixed first-party functions installed by the isolated music preload before website scripts run. Bounded traversal removes only advertising instructions from player responses, preserving access checks, media and license data. A fallback uses the native Skip Ad button or finishes positively identified playing ad media without selecting another song or changing volume. Disable restores native parsers and removes observers. The page-world handle exposes only an enable boolean and aggregate counts, with no Electron or IPC objects; the main process accepts configuration/status traffic only from the music session's main frame on the music origin.

## Trust boundaries

- The real Google/YouTube website runs with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` and normal web security, in a persistent site-only session.
- Website JavaScript receives no YTMusic+ bridge. The isolated music preload samples bounded player/queue metadata, artist links and a login boolean through a fixed read-only page-world function and accepts validated main-process commands. Fixed native-player functions receive only validated volume/mute values or a bounded YouTube Music artist ID. It never reads cookies or authentication tokens. Native lyrics use a closed shadow root, declarative text/controls and actions restricted to the mounted plugin descriptor.
- The first-party shell uses a custom application scheme and a strict CSP. Its explicit IPC schema validates the sender's exact webContents, main frame and origin. No arbitrary channel names, Node globals or Electron objects are exposed.
- Each plugin runs in its own sandboxed, hidden BrowserWindow and ephemeral session. The host denies permission requests, navigation, popups, webviews, direct network requests, workers and frames. Code assets are served only from that plugin's validated package or the packaged runtime.
- Every broker operation checks the declared and approved permission. Queue metadata is filtered separately. Storage ownership is assigned from the IPC sender, never from a supplied plugin ID.

These boundaries follow [Electron's security recommendations](https://www.electronjs.org/docs/latest/tutorial/security). An Electron/Chromium vulnerability can still compromise a native desktop application; keep supported dependencies and the runtime updated.

## Package validation

The installer validates IDs, semantic versions, compatibility, entry paths and permission lists before activation. ZIPs/folders are staged, limited to 20 MB expanded and 500 entries, checked for duplicate paths and symlinks, and rejected for absolute paths, traversal, drive names or alternate data streams. Entry points are resolved inside the package root. Built-in IDs cannot be shadowed by an external install. Third-party install and changed manifests require native permission confirmation. Approved manifest digests bind network domains and permissions to the approval.

Sandbox processes have activation timeouts, stop grace periods and heartbeats. Crashes and unresponsive plugins are isolated and their UI/CSS/connections removed. Reload and disable are serialized per plugin. IPC input sizes, call rates, persistent storage and network responses have limits. This is defense in depth, not a guarantee against every CPU/memory exhaustion technique; review untrusted plugins before installing them.

## Native capabilities

Plugin networking uses anonymous Node HTTPS, exact declared hostnames, public IP checks and pinned DNS resolution. Cookies and authorization headers are not forwarded. Redirects, private IPs, non-HTTPS and nonstandard ports are rejected. The room capability also supports the configured relay or a secure relay supplied in a pasted invite, and requires TLS outside loopback.

P2P rooms use a separate first-party sandboxed BrowserWindow, ephemeral session and fixed bundled PeerJS code. Node integration is disabled, the CSP and request filter restrict signaling to `https://0.peerjs.com` and `wss://0.peerjs.com`, and all permission requests, popups, webviews and navigation are denied. The library's default STUN/TURN configuration handles ICE traversal. The host window validates the exact IPC sender, main frame, origin, request schemas and bounded snapshots; plugins receive no PeerJS object, SDP, ICE addresses or networking configuration. Incoming media calls are rejected. This window has no Google session or website endpoint.

The P2P invite includes an unguessable peer ID, room code and private token. Guests send the token inside an encrypted WebRTC data channel, never in PeerJS signaling metadata. The original host runs the same room authority and role checks as the optional relay. Only authenticated guests join, listeners cannot change room playback, and DJ actions require the host's enabled permissions. Payload sizes, connection count, authentication time and message rates are bounded. Cancelling startup, leaving, disabling the owning plugin, renderer failure and app shutdown close the owned connections and window. The original host leaving ends the P2P room.

Filesystem capability means user-selected text import or a validated theme package, not arbitrary reading/writing. Clipboard capability is write-only. Discord capability exposes a narrow activity schema, not a socket or token. UI rendering accepts structured nodes, never plugin HTML/JavaScript.

Crossfade requires `audio.crossfade` and `player.control`. Plugins receive only bounded configuration and status. The core opens one hidden sandboxed music page in the existing music session and applies audio gain through a fixed, sender-validated preload protocol. Popups, webviews and navigation outside the music origin are denied. No media URLs, samples, cookies or DRM interfaces cross the plugin boundary. Ownership cleanup closes the companion and restores unity gain; renderer leases also restore the visible player's output after an interruption. Media that cannot safely use the audio graph keeps normal playback.

Website CSS is a **trusted** capability: CSS can obscure content and load external resources. Custom CSS is user-controlled; theme import asks for trust confirmation. Only grant `ui.inject` to trusted authors. A selected theme or appearance setting can persist independently of the theme plugin UI; owner-scoped CSS is cleaned up on disable.

## Privacy and services

Track metadata is available only to plugins granted player.read (or queue.read for queue metadata). Enabling a lyrics provider sends identifying track metadata to that provider. Enabling presence sends selected metadata to Discord. Joining a room shares display name, roles and track/queue timing with its participants and, for relay rooms, the relay. P2P room data uses encrypted WebRTC channels; some connections use the library's public TURN fallback. PeerJS Cloud receives signaling and peer identifiers, while connected peers and ICE services can learn network addresses as part of normal WebRTC traversal. Room transports have no audio streaming, Google token, cookie or account database. Full invites and room codes are private invitations; public relay hosting needs TLS and deployment access controls suitable for its audience.

Logs intentionally avoid cookies and authentication data, redact common credential patterns and bound message sizes/history. A plugin can still log the data explicitly granted to it. Review exported logs before sharing them. This repository does not publish logs or send diagnostics anywhere.

## Release policy and reporting

Packaged copies use the public `ExoticBlaze/yt-music` GitHub Releases feed over HTTPS. Automatic update checks and downloads are enabled by default and can be disabled in General settings; restarts require user confirmation. With automatic updates disabled, manual checks also ask before downloading. Draft releases, prereleases and downgrades are excluded. Background failures are logged without interrupting playback. Release access is a trust boundary: protect repository/tag permissions and keep installer artifacts and checksum metadata from the same build together. No GitHub token is shipped to users; the release workflow uses a job-scoped token only for publishing a draft.

The local development installer is unsigned unless signing credentials are configured. Configure platform code signing and a consistent Windows publisher identity for signed releases; macOS auto-updates require signing. Checksums validate downloaded bytes against release metadata, while signature verification depends on platform signing configuration. Never set Node integration, disable sandbox/web security, ignore certificate errors or spoof authentication to work around a Google restriction.

If you discover a vulnerability, contact the repository maintainer privately using their published security contact. Include affected version, platform, reproduction and impact without Google credentials, cookies or personal data. Do not post an exploit containing private account information. No maintainer contact or hosting endpoint is invented by this starter repository.
