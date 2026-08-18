# Installing Reframe

Grab the file for your system from the
**[latest release](https://github.com/pavanjoshi914/Reframe/releases/latest)**.
Filenames below use `0.1.0` — substitute the current version.

---

## Linux — Ubuntu / Debian (`.deb`)

Download `reframe_0.1.0_amd64.deb`, then:

```bash
sudo apt install ./reframe_0.1.0_amd64.deb
```

> **Use `apt`, not `sudo dpkg -i`.** `dpkg` installs the app but does **not**
> pull the recording dependencies (GStreamer, ffmpeg, PyGObject) — it stops with
> a dependency error until you run `sudo apt-get install -f`. `apt` does both in
> one step. Needs an internet connection.

Double-clicking the `.deb` to open it in your software centre works too — that
also resolves the dependencies.

---

## Linux — Fedora, Arch, openSUSE, anything else (Flatpak)

The Flatpak is **fully self-contained** — it bundles GStreamer and ffmpeg, so
every feature works with nothing else to install, on any distro.

Download `Reframe-0.1.0-x86_64.flatpak`, then:

```bash
flatpak install --user Reframe-0.1.0-x86_64.flatpak
flatpak run app.reframe.desktop
```

> Requires [Flatpak](https://flatpak.org/setup/) with the Flathub remote (for the
> shared runtime):
> `flatpak remote-add --if-not-exists --user flathub https://flathub.org/repo/flathub.flatpakrepo`

---

## macOS

Download the build for your chip, open the `.dmg`, and drag **Reframe** to
Applications:

- **Apple Silicon** (M1–M4): `Reframe-0.1.0-arm64.dmg`
- **Intel**: `Reframe-0.1.0.dmg`

> The app isn't notarized yet, so on first launch **right-click it → Open**
> instead of double-clicking. If macOS says it's "damaged", clear the quarantine
> flag: `xattr -cr /Applications/Reframe.app`

---

## Windows

Download `Reframe.Setup.0.1.0.exe` and run it.

> Not code-signed yet, so SmartScreen may warn you — click
> **More info → Run anyway**.

---

## Any Linux distro — install script (last resort)

If none of the above fits, this installs the right dependencies for your distro
(apt/dnf/pacman/zypper), fetches the app, and verifies recording works:

```bash
curl -fsSL https://getreframe.vercel.app/install.sh | bash
```

[Read the script first](https://getreframe.vercel.app/install.sh) before piping
it to your shell. It needs `sudo` only to install system packages — pass
`--no-deps` to skip that, or `--uninstall` to remove everything it added.
