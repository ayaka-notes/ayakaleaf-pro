# Ayakaleaf Pro launcher for Apple Silicon

Double-click a locally built macOS app to open an existing Ayakaleaf Pro installation in your default browser. This is a launcher, not an installer: set up and verify your [Toolkit deployment](https://github.com/ayaka-notes/toolkit) first. It requires Docker Desktop for Apple Silicon (with its CLI and Compose plugin), GNU sed, and a local HTTP port published for `sharelatex:80`. Intel Macs, remote Docker hosts and TLS-only/reverse-proxy setups are outside its scope.

From the **Ayakaleaf Pro source checkout**, run:

```sh
bash tools/macos-launcher/build.sh
```

Open `~/Applications/Ayakaleaf Pro.app`. To build on the Desktop instead, pass `"$HOME/Desktop/Ayakaleaf Pro.app"` as the argument. The build uses macOS tools and the repository logo; it does not download an executable or overwrite an existing app. The signature is local (ad hoc), not a notarized distribution signature.

On first launch, select your **trusted Toolkit folder**, not the source checkout. The launcher runs that folder's `bin/docker-compose` with your account's permissions. It remembers only the folder path and asks again if the folder moves. To select a different deployment, run `defaults delete space.ayaka.ayakaleaf.local-launcher ToolkitPath`.

The app starts Docker Desktop if needed, uses its `desktop-linux` context for this process only, and discovers the mapped HTTP port rather than assuming 8080. If the selected web service already answers `/status` with HTTP 200, it opens immediately; otherwise the launcher runs `bin/docker-compose up -d` and waits for readiness. Closing the launcher does not stop the containers. To stop them, use your normal Toolkit workflow.
