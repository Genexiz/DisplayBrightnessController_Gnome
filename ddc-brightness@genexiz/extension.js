// DDC Brightness — brightness sliders for external monitors in GNOME Quick Settings.
// Talks to monitors over DDC/CI using the `ddcutil` command line tool (VCP code 0x10).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
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

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

async function ddcutil(args, cancellable = null) {
    const proc = Gio.Subprocess.new(['ddcutil', ...args],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
    if (!proc.get_successful())
        throw new Error(`ddcutil ${args.join(' ')}: ${stderr.trim() || stdout.trim()}`);
    return stdout;
}

// Persistent helper process (ddc-helper.py) that performs the writes. Spawning
// ddcutil directly from gnome-shell on every slider step forks the compositor
// and makes dragging stutter; writing a line to a pipe is essentially free.
class WriteHelper {
    constructor(path) {
        this._path = path;
        this._proc = null;
        this._stdin = null;
    }

    send(bus, value) {
        try {
            if (!this._proc)
                this._spawn();
            this._stdin.write_all(new TextEncoder().encode(`${bus} ${value}\n`), null);
        } catch (e) {
            console.warn(`[ddc-brightness] helper: ${e.message}`);
            this.destroy();
        }
    }

    _spawn() {
        this._proc = Gio.Subprocess.new(['python3', this._path], Gio.SubprocessFlags.STDIN_PIPE);
        this._stdin = this._proc.get_stdin_pipe();
        this._proc.wait_async(null, () => {
            this._proc = null;
            this._stdin = null;
        });
    }

    destroy() {
        // Closing stdin makes the helper exit on its own.
        try {
            this._stdin?.close(null);
        } catch {}
        this._proc = null;
        this._stdin = null;
    }
}

// One physical monitor reachable over DDC/CI.
class Display {
    constructor(bus, name, helper, cancellable) {
        this.bus = bus;
        this.name = name;
        this.max = 100;
        this.value = 0;
        this._helper = helper;
        this._cancellable = cancellable;
        this._lastWrite = 0;
    }

    async read() {
        // Don't clobber a value that was just written and may still be in flight.
        if (Date.now() - this._lastWrite < 3000)
            return;
        // Terse output: "VCP 10 C <current> <max>"
        const out = await ddcutil(['--bus', this.bus, '--terse', 'getvcp', VCP_BRIGHTNESS],
            this._cancellable);
        const m = out.match(/VCP\s+10\s+C\s+(\d+)\s+(\d+)/);
        if (!m)
            throw new Error(`Unexpected getvcp output: ${out}`);
        this.value = Number(m[1]);
        this.max = Number(m[2]) || 100;
    }

    get fraction() {
        return this.value / this.max;
    }

    setFraction(fraction) {
        const step = this.max * STEP_PERCENT / 100;
        const value = Math.min(this.max,
            Math.round(Math.round(Math.clamp(fraction, 0, 1) * this.max / step) * step));
        if (value === this.value)
            return;
        this.value = value;
        this._lastWrite = Date.now();
        this._helper.send(this.bus, value);
    }
}

async function detectDisplays(helper, cancellable) {
    const out = await ddcutil(['detect', '--terse'], cancellable);
    const displays = [];
    // Only "Display N" sections are usable; "Invalid display" sections are skipped.
    for (const section of out.split(/\n(?=\S)/)) {
        if (!/^Display \d+/.test(section))
            continue;
        const bus = section.match(/I2C bus:\s+\/dev\/i2c-(\d+)/)?.[1];
        if (!bus)
            continue;
        const monitor = section.match(/Monitor:\s+(.*)/)?.[1] ?? '';
        const [, model = ''] = monitor.split(':');
        displays.push(new Display(bus, model.trim() || `Monitor (i2c-${bus})`, helper, cancellable));
    }
    return displays;
}

const DdcBrightnessSlider = GObject.registerClass(
class DdcBrightnessSlider extends QuickSlider {
    _init() {
        super._init({
            iconName: ICON_NAME,
            iconLabel: 'External monitor brightness',
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
        this._displaySliders = displays.map(d => this._addDisplaySlider(d));
        this.set({
            visible: displays.length > 0,
            menuEnabled: displays.length > 1,
        });
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

    sync() {
        this._syncPerDisplay();
        this._syncMain();
    }

    _updateLabel() {
        const n = this._displays.length;
        const actual = n ? this._displays.reduce((s, d) => s + d.fraction, 0) / n : this.slider.value;
        this._percent.text = `${Math.round(actual * 100)}%`;
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
        this._cancellable = new Gio.Cancellable();
        this._helper = new WriteHelper(`${this.path}/ddc-helper.py`);
        this._displays = [];
        this._indicator = new DdcBrightnessIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator, 2);

        // Re-read monitor values each time Quick Settings opens, since the
        // brightness may have been changed with the monitor's own buttons.
        this._menuOpenId = Main.panel.statusArea.quickSettings.menu.connect(
            'open-state-changed', (_menu, open) => {
                if (open)
                    this._refresh().catch(logError);
            });

        this._setup().catch(logError);
    }

    disable() {
        this._cancellable?.cancel();
        this._cancellable = null;
        this._helper?.destroy();
        this._helper = null;
        if (this._menuOpenId) {
            Main.panel.statusArea.quickSettings.menu.disconnect(this._menuOpenId);
            this._menuOpenId = 0;
        }
        this._indicator?.quickSettingsItems.forEach(i => i.destroy());
        this._indicator?.destroy();
        this._indicator = null;
        this._displays = [];
    }

    async _setup() {
        const cancellable = this._cancellable;
        const displays = await detectDisplays(this._helper, cancellable);
        if (cancellable.is_cancelled())
            return;
        this._displays = displays;
        await this._refresh();
        if (!cancellable.is_cancelled())
            this._indicator.item.setDisplays(displays);
    }

    async _refresh() {
        const cancellable = this._cancellable;
        const results = await Promise.allSettled(this._displays.map(d => d.read()));
        if (!cancellable || cancellable.is_cancelled())
            return;
        results.filter(r => r.status === 'rejected')
            .forEach(r => console.warn(`[ddc-brightness] ${r.reason.message}`));
        this._indicator?.item.sync();
    }
}

function logError(e) {
    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        console.error(`[ddc-brightness] ${e.message}`);
}
