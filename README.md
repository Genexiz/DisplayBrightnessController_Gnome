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
Slider (GNOME Shell, GJS) ── ลากลื่นตามเมาส์, ไม่มีการ fork ใดๆ หลังเปิด extension
   │  stdin:  detect | get <bus> | set <bus> <value>
   ▼        stdout: display … | detected | value <bus> <cur> <max>
ddc-helper.py  (โปรเซสเดียว เปิดตั้งแต่ enable)
   │  รวบคำสั่งที่ค้าง: ใช้ set ล่าสุดต่อจอ → detect → get
   ▼
ddcutil --bus N --noverify --skip-ddc-checks --sleep-multiplier 0.2 setvcp 10 <value>
   │  I²C /dev/i2c-N   (~0.14 วินาที/คำสั่ง, ถ้าล้มเหลวลองใหม่ด้วยโหมดปกติ)
   ▼
จอ (DDC/CI, VCP 0x10 = Brightness)
```

- **ไม่ fork gnome-shell** – การ fork compositor (ซึ่งใช้หน่วยความจำเยอะ) ทำให้ทั้งจอค้างชั่วขณะ
  งาน ddcutil ทั้งหมด (ค้นหาจอ / อ่าน / เขียน) จึงไปทำใน `ddc-helper.py`
- **อ่านค่า** – ทุกครั้งที่เปิด Quick Settings (เผื่อปรับด้วยปุ่มบนจอไว้) แต่ถ้ากำลังลากอยู่
  หรือมีการเขียนค่าหลังจากสั่งอ่าน ค่าที่อ่านได้จะถูกทิ้ง — สไลเดอร์จะไม่ถูกดีดกลับ
  (หลักการเดียวกับสไลเดอร์เสียงของ GNOME)
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
