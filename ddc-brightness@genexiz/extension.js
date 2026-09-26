// DDC Brightness — brightness sliders for external monitors in GNOME Quick Settings.
// Talks to monitors over DDC/CI using the `ddcutil` command line tool (VCP code 0x10).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickSlider, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

const VCP_BRIGHTNESS = '10';
const ICON_NAME = 'display-brightness-symbolic';
// The slider moves continuously, but the monitor is only sent a new value when
// the position crosses one of these steps (percent of the monitor's max). DDC/CI
// handles only a handful of writes per second, so fewer, coarser writes keep the
// actual brightness close behind the finger.
const STEP_PERCENT = 5;

Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async');

// Persistent helper process (ddc-helper.py) that runs every ddcutil command.
// gnome-shell itself never forks after startup: forking the compositor stalls
// its frame loop, which showed up as the slider stuttering.
class Helper {
    constructor(path, handlers) {
        this._path = path;
        this._handlers = handlers;
        this._proc = null;
        this._stdin = null;
        this._cancellable = new Gio.Cancellable();
        this._encoder = new TextEncoder();
    }

    send(line) {
        if (this._cancellable.is_cancelled())
            return;
        try {
            if (!this._proc)
                this._spawn();
            this._stdin.write_all(this._encoder.encode(`${line}\n`), null);
        } catch (e) {
            console.warn(`[ddc-brightness] helper: ${e.message}`);
            this._reset();
        }
    }

    _spawn() {
        const proc = Gio.Subprocess.new(['python3', this._path],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        this._proc = proc;
        this._stdin = proc.get_stdin_pipe();
        this._readLoop(new Gio.DataInputStream({base_stream: proc.get_stdout_pipe()}))
            .catch(logError);
        proc.wait_async(null, () => {
            if (this._proc === proc)
                this._reset();
        });
    }

    async _readLoop(stream) {
        for (;;) {
            const [line] = await stream.read_line_async(GLib.PRIORITY_DEFAULT, this._cancellable);
            if (line === null)
                return;
            const [kind, ...args] = new TextDecoder().decode(line).split(' ');
            this._handlers[kind]?.(...args);
        }
    }

    _reset() {
        this._proc = null;
        this._stdin = null;
    }

    destroy() {
        this._cancellable.cancel();
        // Closing stdin makes the helper exit on its own.
        try {
            this._stdin?.close(null);
        } catch {}
        this._reset();
    }
}

// One physical monitor reachable over DDC/CI.
class Display {
    constructor(bus, name, helper) {
        this.bus = bus;
        this.name = name;
        this.max = 100;
        this.value = 0;
        this.known = false;
        this._helper = helper;
        this._writes = 0;
        this._writesAtRead = 0;
    }

    get fraction() {
        return this.value / this.max;
    }

    requestRead() {
        this._writesAtRead = this._writes;
        this._helper.send(`get ${this.bus}`);
    }

    // Returns false when the reading is stale (a write happened after it was requested).
    applyReading(current, max) {
        if (this._writes !== this._writesAtRead)
            return false;
        this.value = current;
        this.max = max || 100;
        this.known = true;
        return true;
    }

    setFraction(fraction) {
        const step = this.max * STEP_PERCENT / 100;
        const value = Math.min(this.max,
            Math.round(Math.round(Math.clamp(fraction, 0, 1) * this.max / step) * step));
        if (value === this.value)
            return;
        this.value = value;
        this._writes++;
        this._helper.send(`set ${this.bus} ${value}`);
    }
}

const DdcBrightnessSlider = GObject.registerClass(
class DdcBrightnessSlider extends QuickSlider {
    _init() {
        super._init({
            iconName: ICON_NAME,
            iconReactive: true,
            iconLabel: 'Re-read brightness from monitor',
            menuButtonAccessibleName: 'Open monitor brightness menu',
        });
        this.slider.accessible_name = 'External monitor brightness';

        this._percent = new St.Label({
            style_class: 'ddc-brightness-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.child.insert_child_below(this._percent, this._menuButton);

        this.menu.setHeader(ICON_NAME, 'Monitor Brightness');
        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._section);

        this._displays = [];
        this._blocked = false;
        this._dragging = false;
        this._trackDrag(this.slider);
        this.slider.connect('notify::value', () => {
            if (this._blocked)
                return;
            for (const d of this._displays)
                d.setFraction(this.slider.value);
            this._blocked = true;
            this._displaySliders?.forEach(s => (s.value = this.slider.value));
            this._blocked = false;
            this._updateLabel();
        });

        this.visible = false;
    }

    setDisplays(displays) {
        this._displays = displays;
        this._section.removeAll();
        // Per-monitor sliders only exist when the submenu is usable.
        this._displaySliders = displays.length > 1
            ? displays.map(d => this._addDisplaySlider(d)) : [];
        this.menuEnabled = displays.length > 1;
        this.sync();
    }

    _addDisplaySlider(display) {
        this._section.addMenuItem(new PopupMenu.PopupMenuItem(display.name, {reactive: false}));
        const slider = new Slider(display.fraction);
        slider.accessible_name = display.name;
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false});
        item.add_child(new St.Bin({
            style_class: 'slider-bin',
            child: slider,
            reactive: true,
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._section.addMenuItem(item);
        this._trackDrag(slider);
        slider.connect('notify::value', () => {
            if (this._blocked)
                return;
            display.setFraction(slider.value);
            this._syncMain();
        });
        return slider;
    }

    // Main slider shows the average of all monitors.
    _syncMain() {
        if (this._displays.length === 0)
            return;
        const avg = this._displays.reduce((s, d) => s + d.fraction, 0) / this._displays.length;
        this._blocked = true;
        this.slider.value = avg;
        this._blocked = false;
        this._updateLabel();
    }

    _syncPerDisplay() {
        this._blocked = true;
        this._displaySliders?.forEach((s, i) => (s.value = this._displays[i].fraction));
        this._blocked = false;
    }

    // Like GNOME's volume slider: never move a slider under the user's pointer.
    _trackDrag(slider) {
        slider.connect('drag-begin', () => (this._dragging = true));
        slider.connect('drag-end', () => (this._dragging = false));
    }

    sync() {
        if (this._dragging)
            return;
        this.visible = this._displays.some(d => d.known);
        this._syncPerDisplay();
        this._syncMain();
    }

    _updateLabel() {
        const n = this._displays.length;
        const actual = n ? this._displays.reduce((s, d) => s + d.fraction, 0) / n : this.slider.value;
        // Only touch the label when the text really changes: every text change
        // relayouts the whole Quick Settings grid.
        const text = `${Math.round(actual * 100)}%`;
        if (this._percent.text !== text)
            this._percent.text = text;
    }
});

const DdcBrightnessIndicator = GObject.registerClass(
class DdcBrightnessIndicator extends SystemIndicator {
    _init() {
        super._init();
        this.item = new DdcBrightnessSlider();
        this.quickSettingsItems.push(this.item);
    }
});

export default class DdcBrightnessExtension extends Extension {
    enable() {
        this._displays = [];
        this._found = [];
        this._indicator = new DdcBrightnessIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator, 2);

        this._helper = new Helper(`${this.path}/ddc-helper.py`, {
            display: (bus, ...name) => this._found.push(new Display(bus, name.join(' '), this._helper)),
            detected: () => {
                this._displays = this._found;
                this._found = [];
                if (this._displays.length === 0)
                    console.warn('[ddc-brightness] No DDC/CI capable monitor found (see `ddcutil detect`)');
                this._indicator.item.setDisplays(this._displays);
                this._displays.forEach(d => d.requestRead());
            },
            value: (bus, current, max) => {
                const display = this._displays.find(d => d.bus === bus);
                if (display?.applyReading(Number(current), Number(max)))
                    this._indicator.item.sync();
            },
            error: (bus, ...msg) => console.warn(`[ddc-brightness] i2c-${bus}: ${msg.join(' ')}`),
        });
        this._helper.send('detect');

        // The monitor is deliberately NOT re-read when Quick Settings opens:
        // on some GPU drivers (seen with NVIDIA) any DDC/CI traffic makes the
        // mouse cursor stutter, so talking to the monitor is limited to startup, the user's
        // own changes, and clicking the slider icon (manual re-sync after using
        // the monitor's buttons).
        this._indicator.item.connect('icon-clicked',
            () => this._displays.forEach(d => d.requestRead()));
    }

    disable() {
        this._helper?.destroy();
        this._helper = null;
        this._indicator?.quickSettingsItems.forEach(i => i.destroy());
        this._indicator?.destroy();
        this._indicator = null;
        this._displays = [];
    }
}

function logError(e) {
    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        console.error(`[ddc-brightness] ${e.message}`);
}
