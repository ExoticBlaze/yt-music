# Listen Together

Everyone runs YTMusic+ and plays music through their own YouTube Music session. The room shares song IDs and playback timing; it does not send audio from the host's computer.

## First-time setup for friends over the internet

You need one shared internet relay. The default `ws://127.0.0.1:8787` starts automatically, but it is only reachable on the same computer. A room code alone cannot connect separate computers to that local relay.

Use the relay-only package built by `npm run build:relay`, in `release/<app-version>/listen-together-relay`. Follow [the hosting guide](server/HOSTING.md) to deploy it on Render. Only the host needs to set up that service. Render assigns the real public address; everyone uses that same address, starting with `wss://`, in the app.

1. Install the updated YTMusic+ on each computer.
2. Open **Settings → Listen Together**.
3. Under **Relay WebSocket URL**, enter your deployed relay's actual `wss://` address. Everyone must use the same address. Do not use `127.0.0.1` for friends on other computers.
4. Set your **Display name**. Leave the drift thresholds at their defaults initially.
5. If the hosted relay has been idle, open its HTTPS address in a browser and wait for the JSON health response before creating or joining a room.

## Create and join

1. The host chooses a song in YouTube Music.
2. Click **Listen Together** in the extension controls beside the native player. If the button is missing, enable the plugin in **Plugins**. The keyboard menu (**Ctrl+K**) also offers **Create Listen Together Room** and **Join Listen Together Room**.
3. Click **Create room**, then **Copy invite code**. Share that code and the relay address with your friends. The **Create Listen Together Room** keyboard command creates the room directly.
4. Friends open **Listen Together**, type the code under **Room code**, and click **Join room**.
5. Their players open the same video ID, match play/pause and adjust their position. Allow time for the song to load. The room panel shows **Connected · Synced ✓** when playback is aligned.

Both computers need access to the exact song in YouTube Music. Different availability, account restrictions, ads or buffering can delay playback. Joining does not grant access to music that an account cannot normally play.

## Controls

- The host controls playback using the native player or the room's **Play / pause**, **Previous** and **Next** buttons. Seeks in the native player are shared.
- The initial shared queue uses the host's already-loaded native queue. Host changes to observable native queue items are shared too.
- Paste a song link into **Add song**, then click **Add to shared queue**. The panel shows the page containing the added song. Click its queue entry to play it for everyone. **Previous queue page** and **Next queue page** browse long queues.
- Participants begin as listeners. The host can promote someone to DJ using the participant controls. **DJ permissions** lets the host enable play/pause, seek and tracks/queue separately. A listener's local controls do not change the room.
- Use **Leave room** to leave. If the host leaves and another member remains, a remaining participant becomes host. Disable the plugin in **Plugins** to disconnect and clean up its controls.
- Volume remains personal. Changing your volume does not change your friends' volume.

## If something goes wrong

| Message or symptom                                | What to check                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection refused on `127.0.0.1:8787`            | For a local test, enable **Start local relay automatically**. For internet friends, replace the local URL with the deployed `wss://` address.       |
| Cannot connect to a hosted relay                  | Open its HTTPS health page first, check that the service is Live, and confirm everyone has the same address. Remote relays require secure `wss://`. |
| Room not found                                    | Check both the code and relay address. Rooms are held in memory; if the relay restarted, slept or redeployed, create a fresh room.                  |
| Out of Sync or the song does not open             | Check that the exact song is playable in that person's account. Let loading finish and rejoin if necessary.                                         |
| A newly added song is not on the first queue page | Use the queue page buttons. Adding a song opens its page automatically.                                                                             |

The automatic local relay closes when its owning app exits. Hosted relays run independently of the desktop app. On Render's Free plan, idle wake-up can take about a minute and service restarts lose rooms; see [the hosting guide](server/HOSTING.md) for the current limits and official references.

## Developer verification

`npm start -- --smoke-test --rooms-only --safe-renderer` runs two independent app processes with separate `.smoke-data` profiles and muted audio output. It verifies real native YouTube Music song loading, initial queue, play/pause, seek, a shared queue track change, leave/host transfer and cleanup. No Google profile is copied and no credentials are submitted.
