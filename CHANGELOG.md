# Changelog

## 1.0.0 — 2026-09-26

First public release.

- Quick Settings slider for DDC/CI monitor brightness (VCP 0x10) via `ddcutil`.
- All monitor I/O runs in a long-running helper (`ddc-helper.py`); gnome-shell never forks after startup.
- Slider moves continuously; brightness is applied in 5% steps with coalesced writes.
- Per-monitor sliders in a submenu when more than one monitor is detected.
- Monitor is read at startup and on icon click only (avoids cursor stutter on some GPU drivers).
- Late readings never move a slider that is being dragged.
- `Makefile` with `install`, `uninstall`, `pack`, `link` and `check` targets.
