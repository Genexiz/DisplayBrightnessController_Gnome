# DDC Brightness

**สไลเดอร์ปรับความสว่างจอภายนอก ใน Quick Settings ของ GNOME**

[English](README.md)

![สไลเดอร์ DDC Brightness ใน Quick Settings](docs/screenshot.png)

โน้ตบุ๊กมีสไลเดอร์ปรับแสงมาให้อยู่แล้ว แต่จอคอมตั้งโต๊ะไม่มี GNOME Shell extension
ตัวนี้เพิ่มสไลเดอร์ให้จอที่รองรับ **DDC/CI** โดยเบื้องหลังใช้
[`ddcutil`](https://www.ddcutil.com/) (ตัวเดียวกับที่ `ddcui` ใช้)

## ความสามารถ

- **หน้าตาเหมือนของระบบ** เป็นสไลเดอร์ใน Quick Settings แบบเดียวกับสไลเดอร์เสียง
- **ลากลื่น** สไลเดอร์ขยับตามเมาส์อิสระ ส่วนแสงจอเปลี่ยนเป็นขั้นละ 5% ให้บัส DDC/CI ที่ช้าตามทัน
- **ไม่ทำให้ระบบค้าง** งานคุยกับจอทั้งหมดทำในโปรเซส helper แยก gnome-shell ไม่ต้อง fork หรือรอ I²C
- **หลายจอ** สไลเดอร์หลักปรับทุกจอพร้อมกัน ปุ่ม `›` ปรับแยกทีละจอ
- **แสดงค่าจริง** ตัวเลข % คือค่าที่จอได้รับจริง
- **ซิงก์ใหม่ได้** ถ้าปรับแสงด้วยปุ่มบนจอ คลิกไอคอน ☀ เพื่ออ่านค่าจากจอใหม่

## สิ่งที่ต้องมี

| | |
|---|---|
| GNOME Shell | 50 (ทดสอบบน Ubuntu 26.04) |
| `ddcutil` | 2.x |
| จอ | เปิด DDC/CI ในเมนู OSD ของจอ |
| สิทธิ์ | อ่าน/เขียน `/dev/i2c-*` ได้ |

ตั้งค่า `ddcutil` ครั้งแรก:

```bash
sudo apt install ddcutil
```

```bash
sudo usermod -aG i2c $USER
```

```bash
echo i2c-dev | sudo tee /etc/modules-load.d/i2c-dev.conf
```

จากนั้น Log out แล้ว Log in ใหม่ (หรือรีบูต) แล้วเช็กว่าเจอจอ:

```bash
ddcutil detect
```

## ติดตั้ง

### จาก source

```bash
git clone https://github.com/Genexiz/DisplayBrightnessController_Gnome.git
```

```bash
cd DisplayBrightnessController_Gnome && make install
```

บน **Wayland** ต้อง Log out แล้ว Log in ใหม่ให้ GNOME Shell โหลด extension ก่อน แล้วค่อย:

```bash
make enable
```

เปิด Quick Settings (มุมขวาบน) จะเจอสไลเดอร์ ☀ อยู่ใต้ปุ่มต่างๆ

### จากไฟล์ zip ใน Release

ดาวน์โหลด `ddc-brightness@genexiz.shell-extension.zip` แล้วรัน:

```bash
gnome-extensions install --force ddc-brightness@genexiz.shell-extension.zip
```

Log out แล้ว Log in ใหม่ จากนั้นเปิดใช้งาน:

```bash
gnome-extensions enable ddc-brightness@genexiz
```

### ถอนการติดตั้ง

```bash
make uninstall
```

## หลักการทำงาน

```
สไลเดอร์ใน Quick Settings (GJS รันใน gnome-shell)
   │  ทุกครั้งที่ค่าเปลี่ยน เขียนข้อความ 1 บรรทัดลง pipe (ไม่ fork ไม่รอ)
   │    stdin:  detect | get <bus> | set <bus> <value>
   ▼    stdout: display <bus> <name> | detected | value <bus> <cur> <max>
ddc-helper.py  (โปรเซสเดียว เปิดค้างไว้ตั้งแต่เปิด extension)
   │  รวบคำสั่งที่ค้าง ใช้เฉพาะ "set" ล่าสุดของแต่ละจอ
   ▼
ddcutil --bus N setvcp 10 <value>   ──I²C──▶  จอ (VCP 0x10 = ความสว่าง)
```

เหตุผลของการออกแบบ:

- **gnome-shell ไม่ fork** การเปิดโปรเซสจาก compositor ทำให้การวาดเฟรมสะดุด extension
  จึงเปิด helper ครั้งเดียว หลังจากนั้นแค่เขียนลง pipe
- **รวบคำสั่งเขียน** DDC/CI รับได้ไม่กี่ครั้งต่อวินาที ระหว่างที่กำลังเขียน ค่าใหม่จะถูกเก็บไว้
  และส่งเฉพาะค่าล่าสุด
- **ปรับเป็นขั้น** สไลเดอร์ต่อเนื่อง แต่ค่าจะถูกปัดเป็นขั้นละ 5% ก่อนส่ง (ทั้งช่วงไม่เกิน 20 ครั้ง)
- **คุยกับจอให้น้อยที่สุด** บาง GPU driver (เจอกับ NVIDIA) ทุกครั้งที่รับส่ง DDC/CI
  เคอร์เซอร์เมาส์จะสะดุด จึงอ่านค่าจากจอแค่ตอนเริ่มและตอนคลิกไอคอน ไม่อ่านทุกครั้งที่เปิด Quick Settings
- **สไลเดอร์ไม่ดีดกลับ** เหมือนสไลเดอร์เสียงของ GNOME ค่าที่อ่านมาช้าจะไม่ขยับสไลเดอร์ที่กำลังถูกลาก
  และค่าที่อ่านก่อนการเขียนครั้งล่าสุดจะถูกทิ้ง

## ปรับแต่ง

ค่าที่ปรับได้อยู่ด้านบนของ
[`ddc-brightness@genexiz/extension.js`](ddc-brightness@genexiz/extension.js):

| ค่าคงที่ | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `STEP_PERCENT` | `5` | ขนาดขั้นที่ส่งไปจอ มากขึ้น = เขียนน้อยครั้ง แสงตามเมาส์ทันกว่า, น้อยลง = ละเอียดกว่า |

แฟล็กเร่งความเร็วของ `ddcutil` อยู่ใน
[`ddc-helper.py`](ddc-brightness@genexiz/ddc-helper.py) (`FAST`) ถ้าเขียนไม่สำเร็จ
helper จะลองใหม่ด้วยค่าเวลาปกติให้เอง

## แก้ปัญหา

**ไม่เห็นสไลเดอร์** สไลเดอร์จะซ่อนถ้าไม่เจอจอที่รองรับ DDC/CI ลองรัน `ddcutil detect`
ถ้าขึ้น permission error ให้เช็กว่าอยู่ในกลุ่ม `i2c` ถ้าขึ้น invalid display ให้เปิด DDC/CI ในเมนูจอ

**ดู log:**

```bash
journalctl --user -f -o cat /usr/bin/gnome-shell | grep -i ddc
```

**ปรับแสงด้วยปุ่มบนจอแล้วสไลเดอร์ไม่ตรง** คลิกไอคอน ☀ เพื่ออ่านค่าใหม่

## พัฒนาต่อ

```bash
make link     # ลิงก์โฟลเดอร์นี้เข้า ~/.local/share/gnome-shell/extensions
make check    # ตรวจ syntax ของ extension.js, ddc-helper.py และ metadata.json
make pack     # สร้าง dist/ddc-brightness@genexiz.shell-extension.zip
```

บน Wayland โค้ดใหม่จะโหลดหลัง Log in ใหม่เท่านั้น ถ้าอยากทดสอบเร็วขึ้นให้รัน shell ซ้อน:

```bash
dbus-run-session gnome-shell --devkit --wayland
```

(`--devkit` ต้องติดตั้งแพ็กเกจ `mutter-dev-bin` บน Ubuntu)

## ร่วมพัฒนา

ยินดีรับ issue และ pull request โดยเฉพาะผลทดสอบบน GNOME เวอร์ชันอื่น GPU อื่น และจอรุ่นอื่น
กรุณาแนบผลของ `ddcutil detect` และ `gnome-shell --version` มาด้วย

## License

[GPL-2.0-or-later](LICENSE) เหมือนกับ GNOME Shell
