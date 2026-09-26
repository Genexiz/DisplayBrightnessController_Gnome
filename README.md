# DDC Brightness — สไลเดอร์ปรับแสงจอใน Quick Settings (Ubuntu / GNOME)

GNOME Shell extension ที่เพิ่มสไลเดอร์ปรับความสว่างจอภายนอก (ผ่าน DDC/CI) ลงใน
Control Center / Quick Settings มุมขวาบนของ Ubuntu โดยเบื้องหลังเรียก `ddcutil`
(ตัวเดียวกับที่ `ddcui` ใช้)

```
 ┌───────────── Quick Settings ─────────────┐
 │ 🔊 ━━━━━━━━━━━━○──────────               │
 │ ☀  ━━━━━○───────────────────  10%  ›     │  ← สไลเดอร์นี้
 │ [Wi-Fi] [Bluetooth] [Power Mode] ...     │
 └──────────────────────────────────────────┘
```

## สถาปัตยกรรม

```
Slider (GNOME Shell, GJS)
   │  notify::value  → เขียน "bus value" ลง pipe (ไม่ fork, ไม่บล็อก UI)
   ▼
ddc-helper.py  (โปรเซสเดียว เปิดค้างไว้)
   │  อ่านทุกค่าที่ค้างใน pipe แล้วใช้เฉพาะค่าล่าสุดของแต่ละจอ
   ▼
ddcutil --bus N --noverify --skip-ddc-checks --sleep-multiplier 0.2 setvcp 10 <value>
   │  I²C /dev/i2c-N   (~0.14 วินาที/คำสั่ง, ถ้าล้มเหลวลองใหม่ด้วยโหมดปกติ)
   ▼
จอ (DDC/CI, VCP 0x10 = Brightness)
```

- **ตรวจหาจอ** – `ddcutil detect --terse` ตอนเปิดใช้ extension
- **อ่านค่า** – `ddcutil --bus N getvcp 10` ตอนเริ่มและทุกครั้งที่เปิด Quick Settings
  (เผื่อปรับด้วยปุ่มบนจอไว้)
- **เขียนค่า** – gnome-shell ไม่ spawn `ddcutil` เองระหว่างลาก (การ fork
  compositor ทำให้กระตุก) แต่ส่งค่าไปให้ `ddc-helper.py` ซึ่งรวบค่าที่ค้างอยู่
  และส่งเฉพาะค่าล่าสุดไปที่จอ
- **ปรับเป็นขั้น** – สไลเดอร์เลื่อนลื่นตามเมาส์ แต่ส่งค่าไปจอเฉพาะเมื่อข้ามขั้นละ 5%
  (`STEP_PERCENT` ใน `extension.js`) ตัวเลข % แสดงค่าจริงที่จอได้รับ
- **หลายจอ** – สไลเดอร์หลักปรับทุกจอพร้อมกัน, ปุ่ม `›` เปิดเมนูปรับแยกทีละจอ
  (ปุ่มนี้จะแสดงเมื่อมีจอมากกว่า 1 จอ)

## สิ่งที่ต้องมี (เครื่องนี้พร้อมแล้ว)

| รายการ | สถานะ |
|---|---|
| `ddcutil` ≥ 2.x | 2.2.5 ✅ |
| ผู้ใช้อยู่ในกลุ่ม `i2c` | ✅ |
| โมดูล `i2c-dev` / `/dev/i2c-*` | ✅ |
| เปิด DDC/CI ในเมนู OSD ของจอ | ✅ (LG ULTRAGEAR บน `/dev/i2c-14`) |

ถ้าเป็นเครื่องใหม่:

```bash
sudo apt install ddcutil
```

```bash
sudo usermod -aG i2c $USER
```

```bash
echo i2c-dev | sudo tee /etc/modules-load.d/i2c-dev.conf
```

## ติดตั้ง

ขั้นตอนนี้ทำไว้ให้แล้วบนเครื่องนี้ (symlink + เพิ่มเข้า `enabled-extensions`):

```bash
ln -sfn "$PWD/ddc-brightness@genexiz" ~/.local/share/gnome-shell/extensions/ddc-brightness@genexiz
```

```bash
gnome-extensions enable ddc-brightness@genexiz
```

บน **Wayland** ตัว GNOME Shell จะโหลด extension ใหม่ได้ก็ต่อเมื่อ **Log out แล้ว Log in ใหม่**
หลังจากนั้นเปิด Quick Settings (มุมขวาบน) ก็จะเจอสไลเดอร์ ☀

## ดีบัก

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell | grep ddc-brightness
```

```bash
ddcutil detect
```

## ไอเดียต่อยอด

- หน้าตั้งค่า (`prefs.js`): เลือกจอ, ตั้งค่าต่ำสุด, ตั้ง `--sleep-multiplier`
- คีย์ลัดเพิ่ม/ลดแสง พร้อม OSD
- ซิงก์กับ Night Light หรือปรับตามเวลา
