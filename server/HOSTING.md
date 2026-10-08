# Listen Together: internet relay setup

This directory is a standalone Node relay. It carries room codes, roles, song IDs and playback timing. Everyone plays music through their own YouTube Music session. Upload only this directory's files when hosting it; your desktop app/profile is unnecessary.

## Host on Render

1. Create a GitHub repository and put `relay.cjs`, `package.json`, `package-lock.json` and `render.yaml` in its root. This hosting bundle contains no account or music profile data.
2. Sign in to Render and choose **New → Blueprint**. Connect that repository, review the single web service and its Free plan, then create it. The supplied configuration installs the relay's dependencies, starts it and binds to Render's assigned `PORT` on `0.0.0.0`.
3. Wait for the service to show **Live**. Open its actual HTTPS URL. The page should show `{"service":"YTMusic+ synchronization relay","version":1}`.
4. Copy the service's URL and change the starting `https://` to `wss://`. For example, an assigned URL of `https://your-actual-service.onrender.com` becomes `wss://your-actual-service.onrender.com`. Use the real assigned address, not this example.
5. In YTMusic+, everyone opens **Settings → Listen Together** and enters that same address under **Relay WebSocket URL**, then sets their display name. The automatic local-start option only affects the local default URL.
6. The host starts a song, opens **Listen Together** and clicks **Create room**, then **Copy invite code**. Friends open the same panel, enter the code and click **Join room**.

Render supports public secure WebSockets and supplies HTTPS for its service URL. Its Free plan has usage limits and sleeps after 15 minutes without incoming HTTP/WebSocket traffic. Waking a sleeping service can take about a minute: open its HTTPS page and wait for the JSON health response before creating/joining a room. The relay keeps rooms in memory; a restart, redeploy or sleep loses existing rooms, so create a new room afterward. Keep one service instance so everyone uses the same room registry.

Official references: [Web services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket), [Free service limits](https://render.com/docs/free), [Blueprints](https://render.com/docs/infrastructure-as-code).

## Run on your own server

Install Node.js 22.12 or newer, run `npm ci --omit=dev`, then `npm start` in this directory. The local default is `127.0.0.1:8787`. For hosting, set `YTM_ROOM_HOST=0.0.0.0` and `PORT` (or `YTM_ROOM_PORT`) to the intended HTTP port. Put a TLS reverse proxy in front and use its `wss://` address in the app. Remote unencrypted `ws://` connections are rejected.

Room codes are private invitations; share them with your group. This sample relay has no account authentication or durable room storage. It does not stream music or forward Google credentials.
