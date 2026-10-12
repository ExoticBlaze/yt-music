# Listen Together

Everyone runs YTMusic+ and plays music through their own YouTube Music session. The room shares song IDs and playback timing; it does not send audio from the host's computer.

## Invite friends over the internet with PeerJS

1. Install YTMusic+ **1.4.4 or newer** on each computer and enable **Listen Together** in Plugins.
2. Choose a song, open **Listen Together** beside the native player, and click **Start internet room**. Wait for your room code to appear.
3. Click **Copy invite** and send the copied text to your friends.
4. Friends paste the entire invite into **Invite or room code** and click **Join room**. No relay settings, hosting account, terminal, or separate helper installation are needed.
5. Their players open the same song and the panel shows **Connected · Synced ✓** once playback matches.

Keep the host's app open. **Leave room**, disabling the plugin, or quitting the host app closes its WebRTC connections and ends the P2P room for everyone. Start a new internet room and share a fresh invite for the next session. **Cancel** stops a startup in progress. If starting fails, the panel shows an error and allows another attempt.

The app bundles the JavaScript library **PeerJS 1.5.5**. PeerJS Cloud handles connection signaling, then each friend's app opens an encrypted WebRTC data channel to the host. The library's default STUN and TURN configuration helps traverse routers; the panel reports **direct P2P** or **TURN fallback** when the connection route is available. Some networks still block WebRTC or the fallback, and the public connection services must be reachable. No tunnel helper, hosting account or port forwarding is needed. [PeerJS connection FAQ](https://peerjs.com/client/faq).

The full invite contains a random peer ID, room code and private token. Share it only with people you want to join. The token is checked inside the encrypted data channel; it is not sent as signaling metadata. Room messages contain song IDs, playback timing, queue items, names and roles. Everyone plays music through their own YouTube Music account. WebRTC can reveal network addresses to connected peers and the connection services; the app does not give plugins ICE addresses, audio, cookies or Google account tokens.

## Optional: use a permanent hosted relay

For a relay that runs independently of the host PC, use one shared internet relay. The default `ws://127.0.0.1:8787` is only reachable on the same computer. A room code alone cannot connect separate computers to that local relay; a full internet invite contains the connection address too.

Use the relay-only package built by `npm run build:relay`, in `release/<app-version>/listen-together-relay`. Follow [the hosting guide](server/HOSTING.md) to deploy it on Render. Only the host needs to set up that service. Render assigns the real public address; everyone uses that same address, starting with `wss://`, in the app.

1. Install the updated YTMusic+ on each computer.
2. Open **Settings → Listen Together**.
3. Under **Relay WebSocket URL**, enter your deployed relay's actual `wss://` address. Everyone must use the same address. Do not use `127.0.0.1` for friends on other computers.
4. Set your **Display name**. Leave the drift thresholds at their defaults initially.
5. If the hosted relay has been idle, open its HTTPS address in a browser and wait for the JSON health response before creating or joining a room.

## Create and join

1. The host chooses a song in YouTube Music.
2. Click **Listen Together** in the extension controls beside the native player. If the button is missing, enable the plugin in **Plugins**. The keyboard menu (**Ctrl+K**) also offers **Create Listen Together Room** and **Join Listen Together Room**.
3. Click **Create room**. A hosted relay offers **Copy invite**, which includes the address and code. A local room offers **Copy invite code** for sessions on the same computer. The **Create Listen Together Room** keyboard command creates the room directly.
4. Friends open **Listen Together**, paste the full **Copy invite** text under **Invite or room code**, and click **Join room**. A code alone also works when everyone has configured the same relay address.
5. Their players open the same video ID, match play/pause and adjust their position. Allow time for the song to load. The room panel shows **Connected · Synced ✓** when playback is aligned.

Both computers need access to the exact song in YouTube Music. Different availability, account restrictions, ads or buffering can delay playback. Joining does not grant access to music that an account cannot normally play.

## Controls

- The host controls playback using the native player or the room's **Play / pause**, **Previous** and **Next** buttons. Seeks in the native player are shared.
- The initial shared queue uses the host's already-loaded native queue. Host changes to observable native queue items are shared too.
- Paste a song link into **Add song**, then click **Add to shared queue**. The panel shows the page containing the added song. Click its queue entry to play it for everyone. **Previous queue page** and **Next queue page** browse long queues.
- Participants begin as listeners. The host can promote someone to DJ using the participant controls. **DJ permissions** lets the host enable play/pause, seek and tracks/queue separately. A listener's local controls do not change the room.
- Use **Leave room** to leave. On a permanent relay, a remaining participant becomes host when the current host leaves. A P2P room ends when its original hosting app leaves or closes. Disable the plugin in **Plugins** to disconnect and clean up its controls and connections.
- Volume remains personal. Changing your volume does not change your friends' volume.

## If something goes wrong

| Message or symptom                                | What to check                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection refused on `127.0.0.1:8787`            | For a local test, enable **Start local relay automatically**. For internet friends, use **Start internet room** and share its full invite.          |
| Host offline or invite expired                    | Keep the original host's app and room open. Start a fresh internet room and copy its new invite. A room code alone cannot join a P2P room.          |
| Cannot reach the PeerJS connection service        | Check internet access to PeerJS Cloud and retry. The connection service is required to create or join a P2P room.                                   |
| Could not establish a WebRTC connection           | Try another network if WebRTC or TURN traffic is blocked. An optional permanent secure relay can be used on networks that allow WebSockets.         |
| Cannot connect to a hosted relay                  | Open its HTTPS health page first, check that the service is Live, and confirm everyone has the same address. Remote relays require secure `wss://`. |
| Room not found                                    | Check both the code and relay address. Rooms are held in memory; if the relay restarted, slept or redeployed, create a fresh room.                  |
| Out of Sync or the song does not open             | Check that the exact song is playable in that person's account. Let loading finish and rejoin if necessary.                                         |
| A newly added song is not on the first queue page | Use the queue page buttons. Adding a song opens its page automatically.                                                                             |

The automatic local relay closes when its owning app exits. Hosted relays run independently of the desktop app. On Render's Free plan, idle wake-up can take about a minute and service restarts lose rooms; see [the hosting guide](server/HOSTING.md) for the current limits and official references.

## Developer verification

`npm start -- --smoke-test --rooms-only --safe-renderer` runs two independent app processes with separate `.smoke-data` profiles and muted audio output. It verifies real native YouTube Music song loading, initial queue, play/pause, seek, a shared queue track change, leave/host transfer and cleanup. No Google profile is copied and no credentials are submitted.

`npm start -- --smoke-test --internet-rooms-only --safe-renderer` performs the two-player checks using actual PeerJS Cloud signaling, WebRTC data channels and the copied/pasted full invite, then verifies that leaving the host disconnects the listener. It creates a temporary P2P room and cleans it up. Both app processes run on the test computer; this verifies the transport and native synchronization, but does not cover every router or internet network.
